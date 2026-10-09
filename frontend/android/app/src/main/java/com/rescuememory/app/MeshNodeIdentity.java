package com.rescuememory.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** A restored browser/prefs ID cannot identify a different Android Keystore key. */
final class MeshNodeIdentity {
    static String fingerprint(byte[] publicKey) throws NoSuchAlgorithmException {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(publicKey);
        StringBuilder hex = new StringBuilder();
        for (byte value : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return hex.toString();
    }

    static String resolve(String storedId, String storedFingerprint, boolean credentialMatches, String fingerprint) {
        if (storedId != null && !storedId.isEmpty() && (fingerprint.equals(storedFingerprint) || credentialMatches)) return storedId;
        return "node_" + fingerprint;
    }
}
