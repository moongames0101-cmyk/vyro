package app.vyro.chat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.IOException;

public class MainActivity extends Activity {
    private WebView webView;
    private LocalAssetServer assetServer;
    private ValueCallback<Uri[]> filePathCallback;
    public static final int FILE_CHOOSER_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int bgColor = Color.parseColor("#07070D");

        // ── System bar colours (safe across API 21-36+) ──
        Window window = getWindow();
        try {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            // setStatusBarColor / setNavigationBarColor are deprecated on API 35+
            // but still safe to call — wrap in a version check to be explicit.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && Build.VERSION.SDK_INT < 35) {
                window.setStatusBarColor(bgColor);
                window.setNavigationBarColor(bgColor);
            }
        } catch (Exception ignored) {
            // Some OEM ROMs throw on bar colour APIs — swallow and continue
        }

        // Dark system bar icons (API 30+)
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                android.view.WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsAppearance(
                        0,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    );
                }
            } catch (Exception ignored) {}
        }

        // ── Root layout ──
        FrameLayout rootContainer = new FrameLayout(this);
        rootContainer.setBackgroundColor(bgColor);
        rootContainer.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        rootContainer.addView(webView);
        setContentView(rootContainer);

        // Keep WebView safely inside system bars, notches & IME on Android 5 through Android 16+
        try {
            rootContainer.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    try {
                        if (Build.VERSION.SDK_INT >= 30) {
                            android.graphics.Insets bars = insets.getInsets(
                                WindowInsets.Type.systemBars()
                                    | WindowInsets.Type.displayCutout()
                                    | WindowInsets.Type.ime()
                            );
                            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                            return WindowInsets.CONSUMED;
                        }
                    } catch (Exception ignored) {}
                    // Fallback for API 21-29
                    try {
                        v.setPadding(
                            insets.getSystemWindowInsetLeft(),
                            insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(),
                            insets.getSystemWindowInsetBottom()
                        );
                        return insets.consumeSystemWindowInsets();
                    } catch (Exception ignored) {
                        return insets;
                    }
                }
            });
            rootContainer.requestApplyInsets();
        } catch (Exception ignored) {}

        // ── WebView settings ──
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // ── Cookies ──
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        webView.setBackgroundColor(bgColor);
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);

        // ── Runtime permissions (camera & mic for voice stage) ──
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] perms = {
                "android.permission.CAMERA",
                "android.permission.RECORD_AUDIO"
            };
            requestPermissions(perms, 2001);
        }

        webView.setWebChromeClient(new VyroChromeClient(this));
        webView.setWebViewClient(new VyroWebViewClient());

        // ── Start the local asset server and load the app ──
        try {
            assetServer = new LocalAssetServer(getAssets());
            int port = assetServer.start();
            webView.loadUrl("http://127.0.0.1:" + port + "/index.html");
        } catch (IOException e) {
            webView.loadData(
                "<html><body style='background:#07070D;color:#fff;font-family:sans-serif;padding:40px;text-align:center'>"
                + "<h2>Failed to start VYRO</h2><p>" + e.getMessage() + "</p>"
                + "<p>Try restarting the app.</p></body></html>",
                "text/html", "UTF-8"
            );
        }
    }

    // ── WebChromeClient: permission grants & file chooser ──
    public static class VyroChromeClient extends WebChromeClient {
        private final MainActivity activity;

        public VyroChromeClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            request.grant(request.getResources());
                        } catch (Exception ignored) {}
                    }
                });
            }
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (activity.filePathCallback != null) {
                activity.filePathCallback.onReceiveValue(null);
            }
            activity.filePathCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            String mimeType = "image/*";
            if (params != null && params.getAcceptTypes() != null && params.getAcceptTypes().length > 0) {
                String first = params.getAcceptTypes()[0];
                if (first != null && !first.trim().isEmpty()) {
                    mimeType = first.trim();
                }
            }
            intent.setType(mimeType);
            try {
                activity.startActivityForResult(Intent.createChooser(intent, "Select Photo / Media"), FILE_CHOOSER_REQUEST);
            } catch (Exception e) {
                activity.filePathCallback.onReceiveValue(null);
                activity.filePathCallback = null;
                return false;
            }
            return true;
        }
    }

    // ── WebViewClient: keep local URLs in-app, open external in browser ──
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
