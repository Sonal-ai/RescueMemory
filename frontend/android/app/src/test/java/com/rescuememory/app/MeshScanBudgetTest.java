package com.rescuememory.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class MeshScanBudgetTest {
    @Test public void competingCallersCannotRestartScannerWithoutBound() {
        MeshScanBudget budget = new MeshScanBudget();
        for (long at : new long[]{0, 1000, 2000, 3000}) { assertEquals(0, budget.delayMillis(at)); budget.started(at); }
        assertEquals(26000, budget.delayMillis(4000));
        assertEquals(0, budget.delayMillis(30000)); budget.started(30000);
        assertEquals(1000, budget.delayMillis(30000));
    }
}
