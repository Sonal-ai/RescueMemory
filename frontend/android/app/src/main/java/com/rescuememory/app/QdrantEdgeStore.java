package com.rescuememory.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** Owned by the plugin's single worker. No HTTP client or downloaded model. */
public final class QdrantEdgeStore implements AutoCloseable {
    static { System.loadLibrary("rescue_qdrant_edge"); }
    private long shard;
    private long bm25;
    private final String packVersion;
    private final int bundledCards;
    private final SharedPreferences metadata;

    public QdrantEdgeStore(Context context, File root) throws Exception {
        JSONObject pack;
        try (InputStream stream = context.getAssets().open("qdrant/knowledge-pack.json")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192]; int length;
            while ((length = stream.read(chunk)) != -1) buffer.write(chunk, 0, length);
            pack = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
        }
        packVersion = pack.getString("version");
        bundledCards = pack.getInt("card_count");
        JSONArray cards = pack.getJSONArray("cards");
        if (cards.length() != bundledCards || bundledCards < 1) throw new IllegalStateException("Invalid bundled knowledge pack");
        metadata = context.getSharedPreferences("edge-" + UUID.nameUUIDFromBytes(bytes(root.getCanonicalPath())), Context.MODE_PRIVATE);
        if (!root.exists() && !root.mkdirs()) throw new IllegalStateException("Cannot create private Edge storage");
        File[] existing = root.listFiles();
        if (existing == null) throw new IllegalStateException("Cannot inspect private Edge storage");
        try {
            // A load error is surfaced. Existing shard data is never erased/recreated.
            shard = nativeOpen(bytes(root.getCanonicalPath()), existing.length > 0);
            bm25 = nativeBm25Create(bytes(pack.getJSONObject("bm25").toString()));
            JSONObject info = new JSONObject(text(nativeInfo(shard)));
            if (!packVersion.equals(metadata.getString("pack_version", "")) || info.getLong("points_count") < bundledCards) {
                upsert(cards, "bundle");
                nativeOptimize(shard);
                nativeFlush(shard);
                if (new JSONObject(text(nativeInfo(shard))).getLong("points_count") < bundledCards) throw new IllegalStateException("Incomplete native reference index");
                if (!metadata.edit().putString("pack_version", packVersion).commit()) throw new IllegalStateException("Cannot commit Edge pack version");
            }
            Log.i("RescueQdrantEdge", "Qdrant Edge 0.8.0 reference shard ready: " + status());
        } catch (Throwable failure) {
            nativeClose(shard, bm25); shard = 0; bm25 = 0;
            throw failure;
        }
    }

    public JSONObject status() throws Exception {
        ensureOpen();
        JSONObject info = new JSONObject(text(nativeInfo(shard)));
        return new JSONObject().put("ready", true).put("engine", "qdrant-edge")
            .put("engine_version", "0.8.0").put("ffi_version", "0.4.1").put("retrieval", "bm25")
            .put("on_device", true).put("pack_version", packVersion).put("bundled_cards", bundledCards)
            .put("indexed_cards", info.getLong("points_count")).put("shard_info", info)
            .put("storage", "app-private/qdrant/reference");
    }

    public JSONObject search(String query, int limit) throws Exception {
        ensureOpen();
        if (query == null || query.length() > 4096 || query.indexOf('\0') >= 0) throw new IllegalArgumentException("Invalid guidance query");
        if (limit < 1 || limit > 10) throw new IllegalArgumentException("Guidance limit must be between 1 and 10");
        long started = System.nanoTime();
        JSONObject sparse = new JSONObject(text(nativeEmbed(bm25, bytes(query.trim()), true)));
        JSONArray cards = new JSONArray();
        if (sparse.getJSONArray("indices").length() > 0) {
            JSONObject filter = new JSONObject().put("must", new JSONArray().put(new JSONObject()
                .put("key", "kind").put("match", new JSONObject().put("value", "protocol"))));
            JSONObject request = new JSONObject().put("vector", sparse).put("using", "bm25")
                .put("limit", limit).put("with_payload", true).put("with_vector", false).put("filter", filter);
            JSONArray hits = new JSONArray(text(nativeSearch(shard, bytes(request.toString()))));
            for (int i = 0; i < hits.length(); i++) {
                JSONObject hit = hits.getJSONObject(i);
                double score = hit.getDouble("score");
                if (Double.isFinite(score) && score > 0) {
                    JSONObject card = hit.getJSONObject("payload");
                    card.remove("_edge_hash"); card.remove("_edge_origin");
                    card.put("score", score); cards.put(card);
                }
            }
        }
        JSONObject result = status().put("cards", cards).put("elapsed_ms", (System.nanoTime() - started) / 1_000_000.0);
        Log.i("RescueQdrantEdge", "Native BM25 query completed: hits=" + cards.length() + " time_ms=" + result.getDouble("elapsed_ms"));
        return result;
    }

    public int upsertGuides(JSONArray guides) throws Exception {
        ensureOpen();
        if (guides == null || guides.length() > 64) throw new IllegalArgumentException("At most 64 guides per batch");
        int updated = upsert(guides, "import");
        if (updated > 0) nativeOptimize(shard);
        // A retry may find matching payloads after an earlier failed flush.
        // Flush even unchanged batches before acknowledging durability.
        nativeFlush(shard);
        return updated;
    }

    private int upsert(JSONArray records, String origin) throws Exception {
        int updated = 0;
        // Validate the entire input before the first database write.
        for (int i = 0; i < records.length(); i++) {
            JSONObject card = records.getJSONObject(i);
            if (card.optString("id").isEmpty() || card.optString("id").length() > 200 ||
                card.optString("title").isEmpty() || card.toString().length() > 100000 ||
                card.toString().indexOf("\\u0000") >= 0) throw new IllegalArgumentException("Malformed emergency guide");
        }
        for (int start = 0; start < records.length(); start += 16) {
            JSONArray ids = new JSONArray();
            int end = Math.min(records.length(), start + 16);
            for (int i = start; i < end; i++) ids.put(pointId(records.getJSONObject(i).getString("id")));
            JSONArray stored = new JSONArray(text(nativeRetrieve(shard, bytes(ids.toString()))));
            java.util.Map<String, JSONObject> prior = new java.util.HashMap<>();
            for (int i = 0; i < stored.length(); i++) {
                JSONObject payload = stored.getJSONObject(i).getJSONObject("payload");
                prior.put(payload.getString("id"), payload);
            }
            JSONArray points = new JSONArray();
            for (int i = start; i < end; i++) {
                JSONObject card = new JSONObject(records.getJSONObject(i).toString());
                String id = card.getString("id");
                card.put("kind", card.optString("kind", "protocol"));
                JSONObject previous = prior.get(id);
                String hash = hex(MessageDigest.getInstance("SHA-256").digest(bytes(card.toString())));
                if (previous != null && (hash.equals(previous.optString("_edge_hash")) ||
                    previous.optInt("version", 1) > card.optInt("version", 1) ||
                    (origin.equals("bundle") && previous.optString("_edge_origin").equals("import") &&
                     previous.optInt("version", 1) >= card.optInt("version", 1)))) continue;
                String searchable = card.optString("title") + " " + card.optString("keywords") + " " + card.optString("summary") + " " +
                    card.optString("applicability") + " " + card.optJSONArray("instructions") + " " + card.optJSONArray("warnings");
                JSONObject sparse = new JSONObject(text(nativeEmbed(bm25, bytes(searchable), false)));
                card.put("_edge_hash", hash).put("_edge_origin", origin);
                points.put(new JSONObject().put("id", pointId(id)).put("vector", new JSONObject().put("bm25", sparse)).put("payload", card));
            }
            if (points.length() > 0) { nativeUpsert(shard, bytes(points.toString())); updated += points.length(); }
        }
        return updated;
    }

    private void ensureOpen() { if (shard == 0 || bm25 == 0) throw new IllegalStateException("Native Edge shard is closed"); }
    private static String pointId(String id) { return UUID.nameUUIDFromBytes(bytes("guidance:" + id)).toString(); }
    private static byte[] bytes(String text) { return text.getBytes(StandardCharsets.UTF_8); }
    private static String text(byte[] bytes) { return new String(bytes, StandardCharsets.UTF_8); }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }
    @Override public void close() { nativeClose(shard, bm25); shard = 0; bm25 = 0; }
    private static native long nativeOpen(byte[] path, boolean existing);
    private static native long nativeBm25Create(byte[] config);
    private static native byte[] nativeEmbed(long model, byte[] text, boolean query);
    private static native void nativeUpsert(long shard, byte[] points);
    private static native byte[] nativeRetrieve(long shard, byte[] ids);
    private static native byte[] nativeSearch(long shard, byte[] request);
    private static native byte[] nativeInfo(long shard);
    private static native void nativeOptimize(long shard);
    private static native void nativeFlush(long shard);
    private static native void nativeClose(long shard, long model);
}
