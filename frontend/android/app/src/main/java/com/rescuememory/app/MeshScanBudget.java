package com.rescuememory.app;

import java.util.ArrayDeque;

/** Bounds scan restarts so foreground/background callers do not exhaust Android's scanner. */
final class MeshScanBudget {
    private final ArrayDeque<Long> starts = new ArrayDeque<>();
    long delayMillis(long now) {
        while (!starts.isEmpty() && now - starts.peekFirst() >= 30000) starts.removeFirst();
        return starts.size() < 4 ? 0 : Math.max(1, 30000 - (now - starts.peekFirst()));
    }
    void started(long now) { starts.addLast(now); }
}
