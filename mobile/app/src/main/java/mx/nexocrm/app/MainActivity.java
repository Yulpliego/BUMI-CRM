package mx.nexocrm.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String EMULATOR_ORIGIN = "http://10.0.2.2:5088";
    private WebView web;
    private LinearLayout errorPanel;
    private SharedPreferences settings;
    private volatile String origin;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        settings = getSharedPreferences("crm", MODE_PRIVATE);
        origin = settings.getString("origin", BuildConfig.DEBUG ? EMULATOR_ORIGIN : "");
        createLayout();
        configureBrowser();
        if (origin.isEmpty()) showServerDialog();
        else connect();
    }

    private void createLayout() {
        int green = Color.rgb(16, 38, 34);
        getWindow().setStatusBarColor(green);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(3), dp(8), dp(3));
        bar.setBackgroundColor(green);
        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        Button server = new Button(this);
        server.setText(R.string.server);
        server.setOnClickListener(view -> showServerDialog());
        bar.addView(server);
        layout.addView(bar);

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(24), dp(24), dp(24), dp(24));
        TextView error = new TextView(this);
        error.setText(R.string.server_unavailable);
        error.setTextSize(16);
        error.setGravity(Gravity.CENTER);
        errorPanel.addView(error);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> connect());
        errorPanel.addView(retry);
        errorPanel.setVisibility(View.GONE);
        layout.addView(errorPanel, new LinearLayout.LayoutParams(-1, 0, 1f));

        web = new WebView(this);
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(layout);
    }

    private void configureBrowser() {
        WebSettings options = web.getSettings();
        options.setJavaScriptEnabled(true);
        options.setAllowFileAccess(false);
        options.setAllowContentAccess(false);
        options.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isSameOrigin(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (isSameOrigin(request.getUrl())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                    java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConnectionError();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showConnectionError();
            }
        });
    }

    private boolean isSameOrigin(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return false;
        int port = uri.getPort();
        if (("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80)) port = -1;
        return origin.equals(scheme.toLowerCase(Locale.ROOT) + "://" +
            host.toLowerCase(Locale.ROOT) + (port == -1 ? "" : ":" + port))
            || (port == -1 && origin.equals(scheme + "://" + host + ("https".equals(scheme) ? ":443" : ":80")));
    }

    private void showServerDialog() {
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setHint(R.string.server_hint);
        field.setText(origin);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.server_title).setView(field)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.connect, null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            String validOrigin = normalizeOrigin(field.getText().toString().trim());
            if (validOrigin == null) {
                field.setError(getString(R.string.invalid_server));
                return;
            }
            origin = validOrigin;
            settings.edit().putString("origin", origin).apply();
            dialog.dismiss();
            connect();
        }));
        dialog.show();
    }

    private static String normalizeOrigin(String text) {
        try {
            URI url = new URI(text);
            String host = url.getHost();
            if (host == null || url.getScheme() == null || url.getUserInfo() != null || url.getQuery() != null || url.getFragment() != null ||
                (!url.getPath().isEmpty() && !url.getPath().equals("/")) || url.getPort() > 65535 || url.getPort() == 0)
                return null;
            String scheme = url.getScheme().toLowerCase(Locale.ROOT);
            host = host.toLowerCase(Locale.ROOT);
            boolean emulator = BuildConfig.DEBUG && (host.equals("10.0.2.2") || host.equals("127.0.0.1"));
            if (!scheme.equals("https") && !(scheme.equals("http") && emulator)) return null;
            int port = url.getPort();
            boolean defaultPort = port == -1 || (scheme.equals("https") ? port == 443 : port == 80);
            return scheme + "://" + host + (defaultPort ? "" : ":" + port);
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    private void connect() {
        if (origin.isEmpty()) { showServerDialog(); return; }
        errorPanel.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(origin + "/");
    }

    private void showConnectionError() {
        web.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private int dp(int amount) {
        return Math.round(amount * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
