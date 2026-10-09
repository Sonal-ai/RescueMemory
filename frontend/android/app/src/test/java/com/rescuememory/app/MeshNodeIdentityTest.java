package com.rescuememory.app;

import org.junit.Test;
import java.security.KeyPairGenerator;
import static org.junit.Assert.*;

public class MeshNodeIdentityTest {
    @Test public void duplicatedLegacyIdsBecomeDistinctForDifferentPhones() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC"); generator.initialize(256);
        String a = MeshNodeIdentity.fingerprint(generator.generateKeyPair().getPublic().getEncoded());
        String b = MeshNodeIdentity.fingerprint(generator.generateKeyPair().getPublic().getEncoded());
        assertNotEquals(MeshNodeIdentity.resolve("copied-id", null, false, a), MeshNodeIdentity.resolve("copied-id", null, false, b));
        assertEquals("node_" + a, MeshNodeIdentity.resolve("copied-id", b, false, a));
    }
    @Test public void updatesKeepBoundIdAndMatchingResponderEnrollment() {
        assertEquals("existing-id", MeshNodeIdentity.resolve("existing-id", "key-a", false, "key-a"));
        assertEquals("enrolled-id", MeshNodeIdentity.resolve("enrolled-id", null, true, "key-a"));
        assertEquals("node_key-a", MeshNodeIdentity.resolve("enrolled-id", "key-b", false, "key-a"));
        assertEquals("node_key-a", MeshNodeIdentity.resolve(null, null, false, "key-a"));
    }
}
