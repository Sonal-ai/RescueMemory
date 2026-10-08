package com.rescuememory.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;

public class MeshIdentityProofTest {
    private KeyPair key() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1")); return generator.generateKeyPair();
    }
    private byte[] sign(KeyPair key, byte[] data) throws Exception {
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key.getPrivate()); signature.update(data); return signature.sign();
    }
    private byte[] raw(byte[] der) {
        int rLength = der[3] & 255, sIndex = 4 + rLength, sLength = der[sIndex + 1] & 255;
        byte[] raw = new byte[64];
        int rSize = Math.min(32, rLength), sSize = Math.min(32, sLength);
        System.arraycopy(der, 4 + rLength - rSize, raw, 32 - rSize, rSize);
        System.arraycopy(der, sIndex + 2 + sLength - sSize, raw, 64 - sSize, sSize);
        return raw;
    }
    @Test public void verifyDerAndRawSignaturesOnIdenticalUtf8Transcript() throws Exception {
        KeyPair phone = key(); byte[] data = "session | फोन 🆘 | random-nonce".getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < 32; i++) {
            byte[] proof = sign(phone, data);
            assertTrue(MeshIdentityProof.verify(phone.getPublic().getEncoded(), proof, data));
            assertTrue(MeshIdentityProof.verify(phone.getPublic().getEncoded(), raw(proof), data));
        }
    }
    @Test public void rejectChangedTranscriptAndOtherPhonesKey() throws Exception {
        KeyPair phone = key(); byte[] data = "bound session".getBytes(StandardCharsets.UTF_8), proof = sign(phone, data);
        assertFalse(MeshIdentityProof.verify(phone.getPublic().getEncoded(), proof, "other session".getBytes(StandardCharsets.UTF_8)));
        assertFalse(MeshIdentityProof.verify(key().getPublic().getEncoded(), proof, data));
    }
    @Test public void rejectTruncatedAndZeroSignatures() throws Exception {
        KeyPair phone = key(); byte[] data = "bound session".getBytes(StandardCharsets.UTF_8);
        assertFalse(MeshIdentityProof.verify(phone.getPublic().getEncoded(), new byte[]{0x30, 1}, data));
        assertFalse(MeshIdentityProof.verify(phone.getPublic().getEncoded(), new byte[64], data));
    }
    @Test(expected = GeneralSecurityException.class) public void rejectMalformedPublicKey() throws Exception {
        MeshIdentityProof.verify(new byte[32], new byte[64], new byte[10]);
    }
    @Test(expected = IllegalArgumentException.class) public void rejectOversizedTranscript() throws Exception {
        MeshIdentityProof.verify(key().getPublic().getEncoded(), new byte[64], new byte[8193]);
    }
}
