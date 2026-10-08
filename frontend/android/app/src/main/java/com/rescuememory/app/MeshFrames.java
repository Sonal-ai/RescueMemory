package com.rescuememory.app;

import java.io.ByteArrayOutputStream;

/** MTU-sized versioned frames, with bounded ordered reassembly. */
final class MeshFrames {
    static final int HEADER = 9, MAX_BYTES = 262144;
    static byte[][] encode(byte[] payload, int id, int limit) {
        // Android 14+ negotiates MTU 517 even when 247 was requested. ATT
        // characteristic values still cannot exceed 512 bytes.
        limit = Math.min(limit, 512);
        int size = limit - HEADER;
        if (size < 1 || payload.length < 1 || payload.length > MAX_BYTES) throw new IllegalArgumentException("Invalid mesh packet size");
        int count = (payload.length + size - 1) / size;
        if (count > 65535) throw new IllegalArgumentException("Too many mesh frames");
        byte[][] chunks = new byte[count][];
        for (int i = 0; i < count; i++) {
            int length = Math.min(size, payload.length - i * size);
            byte[] b = new byte[length + HEADER];
            b[0] = 2; b[1] = (byte)(id >> 24); b[2] = (byte)(id >> 16); b[3] = (byte)(id >> 8); b[4] = (byte)id;
            b[5] = (byte)(i >> 8); b[6] = (byte)i; b[7] = (byte)(count >> 8); b[8] = (byte)count;
            System.arraycopy(payload, i * size, b, HEADER, length); chunks[i] = b;
        }
        return chunks;
    }
    static int id(byte[] b) { return (b[1]&255)<<24 | (b[2]&255)<<16 | (b[3]&255)<<8 | (b[4]&255); }
    static final class Decoder {
        private int id, total, next;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] accept(byte[] b) {
            if (b == null || b.length <= HEADER || b[0] != 2) throw new IllegalArgumentException("Update required: invalid mesh frame");
            int frameId = id(b), index = (b[5]&255)<<8 | (b[6]&255), count = (b[7]&255)<<8 | (b[8]&255);
            if (next == 0) { id = frameId; total = count; }
            if (count == 0 || count != total || id != frameId || index != next || bytes.size() + b.length - HEADER > MAX_BYTES)
                throw new IllegalArgumentException("Invalid mesh frame sequence");
            bytes.write(b, HEADER, b.length - HEADER); next++;
            return next == total ? bytes.toByteArray() : null;
        }
    }
}
