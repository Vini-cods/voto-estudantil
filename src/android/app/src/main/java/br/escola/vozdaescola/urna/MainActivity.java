package br.escola.vozdaescola.urna;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/** An offline-only shell. The only document access is through a user-picked URI. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int PICK_FILE = 1001, SAVE_FILE = 1002;
    private static final int MAX_BYTES = 64 * 1024 * 1024;
    private static final int MAX_BASE64 = ((MAX_BYTES + 2) / 3) * 4;
    private static final Set<String> ASSETS = new HashSet<>(Arrays.asList(
            "/index.html", "/app.js", "/style.css", "/favicon.svg",
            "/assets/gresp.png", "/assets/estado-sp.png"));
    private final ArrayDeque<ExportJob> exports = new ArrayDeque<>();
    private final AtomicInteger exportCount = new AtomicInteger();
    private UrnaApplication application;
    private FrameLayout container;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private ExportJob activeExport;
    private boolean destroyed;
    private boolean backDialog;

    private static final class ExportJob {
        final String id, name, mime;
        final File file;
        ExportJob(String id, String name, String mime, File file) {
            this.id = id; this.name = name; this.mime = mime; this.file = file;
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        application = (UrnaApplication) getApplication();
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(250, 249, 246));
        setContentView(container);
        applyInsets();
        if (Build.VERSION.SDK_INT >= 33) registerBackCallback();
        if (!supportedWebView()) {
            showFailure("Atualize o componente de navegação",
                    "Este aplicativo precisa do Android System WebView ou Google Chrome na versão 80 ou superior. "
                    + "Atualize o componente nas configurações do aparelho e abra o aplicativo novamente.", false);
            return;
        }
        openInterface();
    }

    private boolean supportedWebView() {
        try {
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            if (provider == null || provider.versionName == null) return false;
            return Integer.parseInt(provider.versionName.split("\\.")[0]) >= 80;
        } catch (RuntimeException error) { return false; }
    }

    private void applyInsets() {
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(Color.rgb(250, 249, 246));
        getWindow().setNavigationBarColor(Color.rgb(250, 249, 246));
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            flags |= View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        container.requestApplyInsets();
    }

    private void openInterface() {
        if (destroyed) return;
        if (webView != null) { container.removeView(webView); webView.destroy(); }
        container.removeAllViews();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(250, 249, 246));
        container.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // File-input reads use only the temporary content URI granted by the system picker.
        settings.setAllowContentAccess(true);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSaveFormData(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new LocalBridge(), "UrnaAndroid");
        webView.setWebViewClient(new LocalClient());
        webView.setWebChromeClient(new LocalChrome());
        webView.setDownloadListener((url, agent, disposition, mime, length) ->
                Toast.makeText(this, "Use os botões de salvar do aplicativo.", Toast.LENGTH_SHORT).show());
        webView.loadUrl(HOME);
    }

    private static boolean localOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme())
                && HOST.equals(uri.getEncodedAuthority()) && uri.getPort() == -1;
    }

    private final class LocalClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            return !request.isForMainFrame() || !localOrigin(uri)
                    || !("/".equals(uri.getEncodedPath()) || "/index.html".equals(uri.getEncodedPath()))
                    || uri.getQuery() != null;
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            return !localOrigin(uri) || !("/".equals(uri.getEncodedPath())
                    || "/index.html".equals(uri.getEncodedPath())) || uri.getQuery() != null;
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!localOrigin(uri) || !"GET".equals(request.getMethod()) || uri.getQuery() != null)
                return denied(403, "Forbidden");
            String path = uri.getEncodedPath();
            if ("/".equals(path)) path = "/index.html";
            if (!ASSETS.contains(path)) return denied(404, "Not Found");
            try {
                String mime = path.endsWith(".js") ? "application/javascript"
                        : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml"
                        : path.endsWith(".png") ? "image/png" : "text/html";
                InputStream data = getAssets().open(path.substring(1));
                if ("/index.html".equals(path)) {
                    String html;
                    try (InputStream index = data) {
                        html = new String(readBounded(index, 2 * 1024 * 1024), StandardCharsets.UTF_8);
                    }
                    html = html.replace("__CSRF_TOKEN__", application.store().csrf());
                    data = new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8));
                }
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self'; "
                        + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                        + "connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, data);
            } catch (Exception error) {
                runOnUiThread(() -> showFailure("Não foi possível abrir a urna",
                        "Os dados existentes foram preservados. Feche e abra o aplicativo novamente. "
                        + "Se o problema continuar, procure o responsável pela eleição antes de alterar os dados do aplicativo.", true));
                return denied(503, "Unavailable");
            }
        }
        @Override public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript("document.documentElement.classList.add('android-app');"
                    + "if(!CSS.supports('height','100dvh')){var s=document.createElement('style');"
                    + "s.textContent='.hero-visual{overflow:hidden}.dialog{max-height:calc(100vh - 24px)}.success-page{min-height:100vh}';"
                    + "document.head.appendChild(s)}", null);
        }
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            showFailure("A interface foi interrompida",
                    "Os votos já confirmados continuam salvos. Reabra a interface para continuar.", true);
            return true;
        }
    }

    private static WebResourceResponse denied(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
                java.util.Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(new byte[0]));
    }

    private void showFailure(String title, String message, boolean retry) {
        if (destroyed) return;
        if (webView != null) { container.removeView(webView); webView.destroy(); webView = null; }
        container.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        TextView heading = new TextView(this);
        heading.setText(title); heading.setTextSize(25); heading.setTextColor(Color.rgb(41, 38, 92));
        TextView detail = new TextView(this);
        detail.setText(message); detail.setTextSize(17); detail.setPadding(0, padding, 0, padding);
        panel.addView(heading); panel.addView(detail);
        if (retry) { Button button = new Button(this); button.setText("Reabrir interface");
            button.setOnClickListener(view -> openInterface()); panel.addView(button); }
        container.addView(panel, new FrameLayout.LayoutParams(-1, -2));
    }

    private static byte[] readBounded(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int count, total = 0;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > limit) throw new IOException("Arquivo excede o limite permitido.");
            result.write(buffer, 0, count);
        }
        return result.toByteArray();
    }

    private static JSONObject wrapper(int status, String error) {
        JSONObject value = new JSONObject(), data = new JSONObject();
        try { data.put("error", error); value.put("status", status); value.put("data", data); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return value;
    }

    private static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9_.:-]{1,128}");
    }

    /** Reject excessive nesting before org.json's recursive parser sees it. */
    private static boolean shallowJson(String value) {
        int depth = 0;
        boolean quoted = false, escaped = false;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (quoted) {
                if (escaped) escaped = false;
                else if (character == '\\') escaped = true;
                else if (character == '"') quoted = false;
            } else if (character == '"') quoted = true;
            else if (character == '{' || character == '[') {
                if (++depth > 60) return false;
            } else if (character == '}' || character == ']') {
                if (--depth < 0) return false;
            }
        }
        return depth == 0 && !quoted;
    }

    private void reply(String id, JSONObject value) {
        if (!validId(id)) return;
        String encoded = Base64.encodeToString(value.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        runOnUiThread(() -> {
            if (!destroyed && webView != null) webView.evaluateJavascript(
                    "window.__urnaAndroidReply&&window.__urnaAndroidReply("
                            + JSONObject.quote(id) + "," + JSONObject.quote(encoded) + ");", null);
        });
    }

    private final class LocalBridge {
        @JavascriptInterface public void request(String id, String payload) {
            if (!validId(id)) return;
            if (payload == null || payload.length() > MAX_BYTES) {
                reply(id, wrapper(413, "Solicitação muito grande.")); return;
            }
            application.operations().execute(() -> {
                try {
                    if (!shallowJson(payload)) {
                        reply(id, wrapper(400, "Objeto JSON inválido ou complexo demais.")); return;
                    }
                    JSONObject input = new JSONObject(payload);
                    String method = input.optString("method", "").toUpperCase(Locale.ROOT);
                    String path = input.optString("path", "");
                    if (path.startsWith("/api/")) path = path.substring(5);
                    else if (path.startsWith("api/")) path = path.substring(4);
                    else if (path.startsWith("/")) path = path.substring(1);
                    if (!("GET".equals(method) || "POST".equals(method)) || path.length() > 160
                            || !path.matches("[A-Za-z0-9/_-]{1,160}")) {
                        reply(id, wrapper(400, "Operação inválida.")); return;
                    }
                    Object rawBody = input.opt("body");
                    if (rawBody != null && rawBody != JSONObject.NULL && !(rawBody instanceof JSONObject)) {
                        reply(id, wrapper(400, "Conteúdo inválido.")); return;
                    }
                    String csrf = input.optString("csrf", ""), admin = input.optString("admin", "");
                    if (csrf.length() > 256 || admin.length() > 256) {
                        reply(id, wrapper(400, "Credencial inválida.")); return;
                    }
                    JSONObject result = application.store().handle(method, path,
                            rawBody instanceof JSONObject ? (JSONObject) rawBody : new JSONObject(), csrf, admin);
                    JSONObject state = result.optJSONObject("data");
                    if (state != null && state.has("status")) {
                        boolean voting = "open".equals(state.optString("status"));
                        runOnUiThread(() -> { if (voting) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
                    }
                    reply(id, result);
                } catch (JSONException error) { reply(id, wrapper(400, "Solicitação inválida.")); }
                catch (Exception error) { reply(id, wrapper(500, "Não foi possível concluir. Os dados existentes foram preservados.")); }
            });
        }

        @JavascriptInterface public void saveFile(String id, String filename, String mime, String encoded) {
            enqueueExport(id, filename, mime, encoded);
        }

        @JavascriptInterface public void printDocument() {
            runOnUiThread(() -> {
                if (destroyed || webView == null) return;
                PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
                if (manager != null) manager.print("Voz da Escola",
                        webView.createPrintDocumentAdapter("Voz da Escola"),
                        new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            });
        }
    }

    private final class LocalChrome extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                  FileChooserParams parameters) {
            if (destroyed || activeExport != null) { callback.onReceiveValue(null); return true; }
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            String accepted = String.join(",", parameters.getAcceptTypes()).toLowerCase(Locale.ROOT);
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                    parameters.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            boolean images = accepted.contains("image/") && !accepted.contains("json");
            intent.setType(images ? "image/*" : "*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, images
                    ? new String[]{"image/png", "image/jpeg", "image/webp"}
                    : new String[]{"application/json", "text/json", "text/plain", "application/octet-stream"});
            try { startActivityForResult(intent, PICK_FILE); }
            catch (RuntimeException error) {
                fileCallback = null; callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this, "O seletor de arquivos não está disponível.", Toast.LENGTH_LONG).show();
            }
            return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        @Override public void onGeolocationPermissionsShowPrompt(String origin,
                android.webkit.GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
        @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture,
                                               android.os.Message result) { return false; }
    }

    private static String safeFilename(String value) {
        if (value == null) return "resultado.json";
        String result = value.replaceAll("[\\x00-\\x1f\\x7f\\\\/:*?\"<>|]", "_").trim();
        while (result.startsWith(".")) result = result.substring(1);
        if (result.isEmpty()) result = "resultado.json";
        if (result.length() > 120) result = result.substring(result.length() - 120);
        return result;
    }

    private static String safeMime(String value) {
        String mime = value == null ? "" : value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (Arrays.asList("application/json", "text/csv", "application/pdf", "text/plain",
                "image/png", "image/jpeg", "image/webp", "application/octet-stream").contains(mime)) return mime;
        return "application/octet-stream";
    }

    private void enqueueExport(String id, String filename, String mime, String encoded) {
        if (!validId(id)) return;
        if (encoded == null || encoded.length() > MAX_BASE64) {
            reply(id, wrapper(413, "O arquivo excede o limite permitido.")); return;
        }
        if (exportCount.incrementAndGet() > 4) {
            exportCount.decrementAndGet(); reply(id, wrapper(409, "Conclua o salvamento anterior.")); return;
        }
        application.operations().execute(() -> {
            File temporary = null;
            try {
                byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                if (bytes.length > MAX_BYTES) throw new IOException("Arquivo muito grande.");
                temporary = File.createTempFile("urna-export-", ".tmp", getCacheDir());
                try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(bytes); }
                ExportJob job = new ExportJob(id, safeFilename(filename), safeMime(mime), temporary);
                runOnUiThread(() -> {
                    if (destroyed) { job.file.delete(); exportCount.decrementAndGet(); return; }
                    exports.add(job); launchNextExport();
                });
            } catch (Exception error) {
                if (temporary != null) temporary.delete();
                exportCount.decrementAndGet(); reply(id, wrapper(400, "Não foi possível preparar o arquivo para salvar."));
            }
        });
    }

    private void launchNextExport() {
        if (destroyed || activeExport != null || fileCallback != null || exports.isEmpty()) return;
        activeExport = exports.remove();
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intent.setType(activeExport.mime);
        intent.putExtra(Intent.EXTRA_TITLE, activeExport.name);
        try { startActivityForResult(intent, SAVE_FILE); }
        catch (RuntimeException error) {
            finishExport(activeExport, wrapper(500, "O seletor para salvar arquivos não está disponível."));
        }
    }

    private boolean safeContentUri(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme())) return false;
        String authority = uri.getAuthority();
        return authority != null && !authority.equals(getPackageName())
                && !authority.startsWith(getPackageName() + ".");
    }

    private boolean validPickedFile(Uri uri) {
        if (!safeContentUri(uri)) return false;
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0) && cursor.getLong(0) > MAX_BYTES) return false;
            return true;
        } catch (RuntimeException error) { return false; }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE) {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            if (callback == null) return;
            ArrayList<Uri> selected = new ArrayList<>();
            boolean valid = resultCode == RESULT_OK && data != null;
            if (valid) {
                ClipData clips = data.getClipData();
                if (clips != null) {
                    valid = clips.getItemCount() <= 100;
                    for (int index = 0; valid && index < clips.getItemCount(); index++) {
                        Uri uri = clips.getItemAt(index).getUri();
                        if (!validPickedFile(uri)) valid = false;
                        else selected.add(uri);
                    }
                } else if (validPickedFile(data.getData())) selected.add(data.getData());
                else valid = false;
            }
            callback.onReceiveValue(valid && !selected.isEmpty() ? selected.toArray(new Uri[0]) : null);
            if (resultCode == RESULT_OK && !valid)
                Toast.makeText(this, "Selecione arquivos válidos com até 64 MB cada.", Toast.LENGTH_LONG).show();
            launchNextExport();
        } else if (requestCode == SAVE_FILE && activeExport != null) {
            ExportJob job = activeExport;
            Uri target = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || !safeContentUri(target)) {
                finishExport(job, wrapper(409, "Salvamento cancelado. Use o botão de baixar para tentar novamente."));
                return;
            }
            application.operations().execute(() -> {
                JSONObject response;
                try (InputStream input = new FileInputStream(job.file);
                     OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                    if (output == null) throw new IOException("Destino indisponível.");
                    byte[] buffer = new byte[16384];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                    // The reply is sent only after both streams have closed successfully below.
                    response = new JSONObject().put("status", 200)
                            .put("data", new JSONObject().put("saved", true));
                } catch (Exception error) {
                    response = wrapper(500, "Não foi possível salvar o arquivo. Escolha outro destino e tente novamente.");
                }
                JSONObject completed = response;
                runOnUiThread(() -> finishExport(job, completed));
            });
        }
    }

    private void finishExport(ExportJob job, JSONObject result) {
        job.file.delete();
        exportCount.decrementAndGet();
        if (activeExport == job) activeExport = null;
        reply(job.id, result);
        launchNextExport();
    }

    @android.annotation.TargetApi(33)
    private void registerBackCallback() {
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }

    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (webView == null) { finish(); return; }
        if (backDialog) return;
        webView.evaluateJavascript("(function(){try{if(state.saving||state.configBusy||state.photoBusy)return 'busy';"
                + "var b=document.querySelector('#modal-root [data-action=dismiss]');"
                + "if(b){b.click();return 'handled'}return state.route}catch(e){return 'home'}})()", value -> {
            if (destroyed || "\"handled\"".equals(value)) return;
            if ("\"busy\"".equals(value)) {
                Toast.makeText(this, "Aguarde a conclusão da operação.", Toast.LENGTH_SHORT).show(); return;
            }
            boolean ballot = "\"ballot\"".equals(value);
            backDialog = true;
            new AlertDialog.Builder(this).setTitle(ballot ? "Voltar ao início?" : "Fechar o aplicativo?")
                    .setMessage(ballot ? "O voto desta tela ainda não foi confirmado."
                            : "Os votos confirmados continuam salvos. Salve alterações de cadastro antes de sair.")
                    .setNegativeButton("Continuar", null)
                    .setPositiveButton(ballot ? "Voltar ao início" : "Fechar", (dialog, which) -> {
                        if (ballot && webView != null) webView.evaluateJavascript("goHome()", null);
                        else finish();
                    }).setOnDismissListener(dialog -> backDialog = false).show();
        });
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        container.requestApplyInsets();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        for (ExportJob job : exports) { job.file.delete(); exportCount.decrementAndGet(); }
        exports.clear();
        if (activeExport != null) activeExport.file.delete();
        if (webView != null) {
            webView.stopLoading(); webView.removeJavascriptInterface("UrnaAndroid");
            container.removeView(webView); webView.destroy(); webView = null;
        }
        // The Application owns the store. Leaving a screen must never close its vote queue.
        super.onDestroy();
    }
}
