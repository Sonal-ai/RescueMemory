package com.rescuememory.app;

import android.content.Context;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Display;
import android.view.Surface;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** A real, earth-referenced compass for the survivor radar. No network is used. */
@CapacitorPlugin(name = "CompassHeading")
public class CompassHeadingPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensors;
    private Sensor rotationVector;
    private Sensor accelerometer;
    private Sensor magnetometer;
    private final float[] gravity = new float[3];
    private final float[] magnetic = new float[3];
    private boolean hasGravity;
    private boolean hasMagnetic;
    private boolean started;
    private Float declination;
    private long lastEmission;

    @Override public void load() {
        sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensors != null) {
            rotationVector = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            magnetometer = sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        }
    }

    @PluginMethod public void start(PluginCall call) {
        if (rotationVector == null && (accelerometer == null || magnetometer == null)) {
            call.reject("No magnetometer-based compass is available on this phone.");
            return;
        }
        started = true;
        registerSensors();
        JSObject result = new JSObject();
        result.put("available", true);
        call.resolve(result);
    }

    @PluginMethod public void stop(PluginCall call) {
        started = false;
        sensors.unregisterListener(this);
        call.resolve();
    }

    @PluginMethod public void updateLocation(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lon = call.getDouble("lon");
        if (lat == null || lon == null || !Double.isFinite(lat) || !Double.isFinite(lon)
                || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            call.reject("A valid latitude and longitude are required.");
            return;
        }
        declination = new GeomagneticField(lat.floatValue(), lon.floatValue(), 0f,
                System.currentTimeMillis()).getDeclination();
        call.resolve();
    }

    private void registerSensors() {
        sensors.unregisterListener(this);
        if (rotationVector != null) {
            sensors.registerListener(this, rotationVector, SensorManager.SENSOR_DELAY_UI);
        } else {
            sensors.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_UI);
            sensors.registerListener(this, magnetometer, SensorManager.SENSOR_DELAY_UI);
        }
    }

    @Override public void onSensorChanged(SensorEvent event) {
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - lastEmission < 50) return;
        float[] matrix = new float[9];
        if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) {
            SensorManager.getRotationMatrixFromVector(matrix, event.values);
        } else {
            if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
                System.arraycopy(event.values, 0, gravity, 0, 3);
                hasGravity = true;
            } else if (event.sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) {
                System.arraycopy(event.values, 0, magnetic, 0, 3);
                hasMagnetic = true;
            }
            if (!hasGravity || !hasMagnetic || !SensorManager.getRotationMatrix(matrix, null, gravity, magnetic)) return;
        }

        Display display = getActivity().getWindowManager().getDefaultDisplay();
        int rotation = display == null ? Surface.ROTATION_0 : display.getRotation();
        int axisX = SensorManager.AXIS_X;
        int axisY = SensorManager.AXIS_Y;
        if (rotation == Surface.ROTATION_90) {
            axisX = SensorManager.AXIS_Y;
            axisY = SensorManager.AXIS_MINUS_X;
        } else if (rotation == Surface.ROTATION_180) {
            axisX = SensorManager.AXIS_MINUS_X;
            axisY = SensorManager.AXIS_MINUS_Y;
        } else if (rotation == Surface.ROTATION_270) {
            axisX = SensorManager.AXIS_MINUS_Y;
            axisY = SensorManager.AXIS_X;
        }
        float[] screenMatrix = new float[9];
        if (!SensorManager.remapCoordinateSystem(matrix, axisX, axisY, screenMatrix)) return;
        float[] orientation = new float[3];
        SensorManager.getOrientation(screenMatrix, orientation);
        double magneticHeading = Math.toDegrees(orientation[0]);
        double heading = (magneticHeading + (declination == null ? 0 : declination) + 360) % 360;
        JSObject value = new JSObject();
        value.put("degrees", heading);
        value.put("reference", declination == null ? "magnetic" : "true");
        notifyListeners("heading", value);
        lastEmission = now;
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    @Override protected void handleOnPause() { if (sensors != null) sensors.unregisterListener(this); }
    @Override protected void handleOnResume() { if (started) registerSensors(); }
    @Override protected void handleOnDestroy() { if (sensors != null) sensors.unregisterListener(this); }
}
