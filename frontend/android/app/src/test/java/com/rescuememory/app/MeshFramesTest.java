package com.rescuememory.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;

public class MeshFramesTest {
    @Test public void longUnicodePayloadAtDefaultAndNegotiatedMtu() {
        byte[] data = ("SOS सुरक्षित 🆘 ".repeat(1500)).getBytes(StandardCharsets.UTF_8);
        for (int limit : new int[]{20, 244, 514}) {
            byte[][] frames = MeshFrames.encode(data, 0x7abc4321, limit);
            MeshFrames.Decoder decoder = new MeshFrames.Decoder(); byte[] result = null;
            for (byte[] frame : frames) { assertTrue(frame.length <= limit); result = decoder.accept(frame); }
            assertArrayEquals(data, result);
        }
    }
    @Test(expected = IllegalArgumentException.class) public void rejectOutOfOrder() {
        byte[][] frames = MeshFrames.encode(new byte[100], 4, 20);
        new MeshFrames.Decoder().accept(frames[1]);
    }
    @Test(expected = IllegalArgumentException.class) public void rejectMixedSession() {
        MeshFrames.Decoder decoder = new MeshFrames.Decoder();
        decoder.accept(MeshFrames.encode(new byte[100], 4, 20)[0]);
        decoder.accept(MeshFrames.encode(new byte[100], 5, 20)[1]);
    }
    @Test(expected = IllegalArgumentException.class) public void rejectOversizedMessage() {
        MeshFrames.encode(new byte[MeshFrames.MAX_BYTES + 1], 3, 244);
    }
}
