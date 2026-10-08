package com.rescuememory.app;

import java.math.BigInteger;
import java.security.*;
import java.security.interfaces.ECPublicKey;
import java.security.spec.X509EncodedKeySpec;

/** Verify Keystore phone proofs with Android's provider, without WebView DER conversion. */
final class MeshIdentityProof {
    private static final BigInteger P256_ORDER = new BigInteger("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16);

    static boolean verify(byte[] publicKey, byte[] signature, byte[] data) throws GeneralSecurityException {
        if (publicKey.length > 2048 || signature.length > 144 || data.length > 8192)
            throw new IllegalArgumentException("Identity proof exceeds size limit");
        PublicKey imported = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(publicKey));
        if (!(imported instanceof ECPublicKey)) throw new InvalidKeyException("Expected EC public key");
        ECPublicKey ec = (ECPublicKey) imported;
        if (ec.getParams().getCurve().getField().getFieldSize() != 256 || !P256_ORDER.equals(ec.getParams().getOrder()))
            throw new InvalidKeyException("Expected P-256 public key");
        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(imported); verifier.update(data);
        try { return verifier.verify(asDer(signature)); }
        catch (SignatureException | IllegalArgumentException e) { return false; }
    }

    // SHA256withECDSA normally returns DER. Also support a fixed-width r || s
    // signature when a provider/bridge supplies IEEE P1363 encoding.
    static byte[] asDer(byte[] signature) {
        if (signature.length != 64) return signature;
        byte[] r = integer(signature, 0), s = integer(signature, 32);
        byte[] der = new byte[6 + r.length + s.length];
        der[0] = 0x30; der[1] = (byte)(der.length - 2); der[2] = 0x02; der[3] = (byte)r.length;
        System.arraycopy(r, 0, der, 4, r.length);
        der[4 + r.length] = 0x02; der[5 + r.length] = (byte)s.length;
        System.arraycopy(s, 0, der, 6 + r.length, s.length);
        return der;
    }

    private static byte[] integer(byte[] signature, int offset) {
        int first = offset;
        while (first < offset + 31 && signature[first] == 0) first++;
        boolean pad = (signature[first] & 0x80) != 0;
        byte[] value = new byte[offset + 32 - first + (pad ? 1 : 0)];
        System.arraycopy(signature, first, value, pad ? 1 : 0, offset + 32 - first);
        return value;
    }
}
