package com.rescuememory.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;

public class MeshFramesTest {
    @Test public void identityAndBatteryPresenceSurviveMinimumMtuWithoutPartialJson() {
        String json = "{\"battery\":97,\"charging\":true,\"battery_measured_at\":123456789,\"v\":2,\"type\":\"presence\",\"node_id\":\"phone-real-key\",\"name\":\"फोन 🆘\",\"location\":{\"lat\":0,\"lon\":0}}";
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        for (int limit : new int[]{20, 21, 244, 512}) {
            MeshFrames.Decoder decoder = new MeshFrames.Decoder();
            byte[][] frames = MeshFrames.encode(data, 42, limit);
            for (int i = 0; i < frames.length; i++) {
                byte[] complete = decoder.accept(frames[i]);
                if (i < frames.length - 1) assertNull(complete);
                else assertEquals(json, new String(complete, StandardCharsets.UTF_8));
            }
        }
    }
    @Test public void longUnicodePayloadAtDefaultAndNegotiatedMtu() {
        byte[] data = ("SOS सुरक्षित 🆘 ".repeat(1500)).getBytes(StandardCharsets.UTF_8);
        for (int limit : new int[]{20, 244, 514}) {
            byte[][] frames = MeshFrames.encode(data, 0x7abc4321, limit);
            MeshFrames.Decoder decoder = new MeshFrames.Decoder(); byte[] result = null;
            for (byte[] frame : frames) { assertTrue(frame.length <= limit); result = decoder.accept(frame); }
            assertArrayEquals(data, result);
        }
    }
    @Test public void android14Mtu517NeverCreatesOversizedCharacteristicValues() {
        byte[] payload = ("Large encrypted SOS 🆘 ".repeat(4000)).getBytes(StandardCharsets.UTF_8);
        for (int limit : new int[]{514, 515}) {
            MeshFrames.Decoder decoder = new MeshFrames.Decoder(); byte[] result = null;
            byte[][] frames = MeshFrames.encode(payload, 7, limit);
            assertEquals(512, frames[0].length);
            for (byte[] frame : frames) { assertTrue(frame.length <= 512); result = decoder.accept(frame); }
            assertArrayEquals(payload, result);
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
