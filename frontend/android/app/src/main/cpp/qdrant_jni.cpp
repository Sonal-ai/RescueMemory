#include <jni.h>
#include <string>
#include "qdrant_edge_ffi.h"

// Byte arrays carry standard UTF-8, including supplementary Unicode. JNI's
// GetStringUTFChars/NewStringUTF use modified UTF-8 and would corrupt such text.
static std::string input(JNIEnv* env, jbyteArray data) {
    jsize size = env->GetArrayLength(data);
    std::string value(size, '\0');
    env->GetByteArrayRegion(data, 0, size, reinterpret_cast<jbyte*>(value.data()));
    return value;
}
static void fail(JNIEnv* env) {
    char* error = qe_last_error();
    const std::string message = error ? error : "Qdrant Edge operation failed";
    if (error) qe_free_string(error);
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message.c_str());
}
static jbyteArray output(JNIEnv* env, char* text) {
    if (!text) { fail(env); return nullptr; }
    const std::string value(text);
    qe_free_string(text);
    auto bytes = env->NewByteArray(static_cast<jsize>(value.size()));
    if (bytes) env->SetByteArrayRegion(bytes, 0, value.size(), reinterpret_cast<const jbyte*>(value.data()));
    return bytes;
}
static QeShardHandle* shard(jlong handle) { return reinterpret_cast<QeShardHandle*>(handle); }
static QeBm25Handle* model(jlong handle) { return reinterpret_cast<QeBm25Handle*>(handle); }
#define JNI_METHOD(name) Java_com_rescuememory_app_QdrantEdgeStore_##name

extern "C" JNIEXPORT jlong JNICALL JNI_METHOD(nativeOpen)(JNIEnv* env, jclass, jbyteArray path, jboolean existing) {
    auto p = input(env, path);
    const char* config = R"({"sparse_vectors":{"bm25":{"modifier":"idf"}},"on_disk_payload":true,"wal_options":{"segment_capacity":4194304},"max_search_threads":2})";
    auto handle = existing ? qe_shard_load(p.c_str(), "") : qe_shard_create(p.c_str(), config);
    if (!handle) fail(env);
    return reinterpret_cast<jlong>(handle);
}
extern "C" JNIEXPORT jlong JNICALL JNI_METHOD(nativeBm25Create)(JNIEnv* env, jclass, jbyteArray config) {
    auto text = input(env, config);
    auto handle = qe_bm25_create(text.c_str());
    if (!handle) fail(env);
    return reinterpret_cast<jlong>(handle);
}
extern "C" JNIEXPORT jbyteArray JNICALL JNI_METHOD(nativeEmbed)(JNIEnv* env, jclass, jlong handle, jbyteArray text, jboolean query) {
    auto value = input(env, text);
    return output(env, query ? qe_bm25_embed_query(model(handle), value.c_str()) : qe_bm25_embed_document(model(handle), value.c_str()));
}
extern "C" JNIEXPORT void JNICALL JNI_METHOD(nativeUpsert)(JNIEnv* env, jclass, jlong handle, jbyteArray points) {
    auto json = input(env, points);
    if (qe_shard_upsert(shard(handle), json.c_str()) < 0) fail(env);
}
extern "C" JNIEXPORT jbyteArray JNICALL JNI_METHOD(nativeSearch)(JNIEnv* env, jclass, jlong handle, jbyteArray request) {
    auto json = input(env, request);
    return output(env, qe_shard_search(shard(handle), json.c_str()));
}
extern "C" JNIEXPORT jbyteArray JNICALL JNI_METHOD(nativeRetrieve)(JNIEnv* env, jclass, jlong handle, jbyteArray ids) {
    auto json = input(env, ids);
    return output(env, qe_shard_retrieve(shard(handle), json.c_str(), true, false));
}
extern "C" JNIEXPORT jbyteArray JNICALL JNI_METHOD(nativeInfo)(JNIEnv* env, jclass, jlong handle) { return output(env, qe_shard_info(shard(handle))); }
extern "C" JNIEXPORT void JNICALL JNI_METHOD(nativeFlush)(JNIEnv* env, jclass, jlong handle) { if (qe_shard_flush(shard(handle)) < 0) fail(env); }
extern "C" JNIEXPORT void JNICALL JNI_METHOD(nativeOptimize)(JNIEnv* env, jclass, jlong handle) { if (qe_shard_optimize(shard(handle)) < 0) fail(env); }
extern "C" JNIEXPORT void JNICALL JNI_METHOD(nativeClose)(JNIEnv*, jclass, jlong handle, jlong bm25) {
    if (handle) qe_shard_close(shard(handle));
    if (bm25) qe_bm25_destroy(model(bm25));
}
