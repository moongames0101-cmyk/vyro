package app.vyro.chat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.IOException;

public class MainActivity extends Activity {
    private WebView webView;
    private LocalAssetServer assetServer;
    private ValueCallback<Uri[]> filePathCallback;
    public static final int FILE_CHOOSER_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Dark cosmic navigation and status bar
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#07070D"));
        window.setNavigationBarColor(Color.parseColor("#07070D"));

        // Set layout
        webView = new WebView(this);
        setContentView(webView);

        // WebView Settings
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setBackgroundColor(Color.parseColor("#07070D"));
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);

        // Request runtime permissions if Android 6.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] perms = {
                "android.permission.CAMERA",
                "android.permission.RECORD_AUDIO"
            };
            requestPermissions(perms, 2001);
        }

        webView.setWebChromeClient(new VyroChromeClient(this));
        webView.setWebViewClient(new VyroWebViewClient());

        // Start Local Asset Server
        try {
            assetServer = new LocalAssetServer(getAssets());
            int port = assetServer.start();
            webView.loadUrl("http://127.0.0.1:" + port + "/index.html");
        } catch (IOException e) {
            webView.loadData("<h3>Failed to start VYRO engine: " + e.getMessage() + "</h3>", "text/html", "UTF-8");
        }
    }

    public static class VyroChromeClient extends WebChromeClient {
        private final MainActivity activity;

        public VyroChromeClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            activity.runOnUiThread(new PermissionGranter(request));
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (activity.filePathCallback != null) {
                activity.filePathCallback.onReceiveValue(null);
            }
            activity.filePathCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            activity.startActivityForResult(Intent.createChooser(intent, "Select Image / Snap"), FILE_CHOOSER_REQUEST);
            return true;
        }
    }

    public static class PermissionGranter implements Runnable {
        private final PermissionRequest request;

        public PermissionGranter(PermissionRequest request) {
            this.request = request;
        }

        @Override
        public void run() {
            request.grant(request.getResources());
        }
    }

    public static class VyroWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
                return false;
            }
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                view.getContext().startActivity(intent);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    Uri dataUri = data.getData();
                    if (dataUri != null) {
                        results = new Uri[]{dataUri};
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (assetServer != null) {
            assetServer.stop();
        }
        if (webView != null) {
            webView.destroy();
        }
    }
}
