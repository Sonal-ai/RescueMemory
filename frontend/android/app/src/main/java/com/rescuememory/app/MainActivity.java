package com.rescuememory.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(RescueBlePlugin.class);
        registerPlugin(QdrantEdgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
