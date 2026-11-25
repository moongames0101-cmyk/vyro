package app.vyro.chat;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ProtocolException;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class LocalAssetServer {
    private static final String PREFS_NAME = "vyro_apk_prefs";
    private static final String PREF_SERVER_URL = "vyro_server_url";
    private static final int[] PREFERRED_PORTS = new int[]{17483, 17484, 17485, 0};
    private static final int[] DISCOVERY_PORTS = new int[]{3847, 3899};
    private static final int MAX_BODY_BYTES = 16 * 1024 * 1024;

    private final AssetManager assetManager;
    private final SharedPreferences prefs;
    private ServerSocket serverSocket;
    private Thread serverThread;
    private int port = 0;
    private volatile boolean running = false;
    private volatile String savedServerUrl = "";

    private static final Map<String, String> MIME_TYPES = new HashMap<>();
    static {
        MIME_TYPES.put("html", "text/html; charset=utf-8");
        MIME_TYPES.put("htm", "text/html; charset=utf-8");
        MIME_TYPES.put("js", "application/javascript; charset=utf-8");
        MIME_TYPES.put("mjs", "application/javascript; charset=utf-8");
        MIME_TYPES.put("css", "text/css; charset=utf-8");
        MIME_TYPES.put("json", "application/json; charset=utf-8");
        MIME_TYPES.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME_TYPES.put("png", "image/png");
        MIME_TYPES.put("jpg", "image/jpeg");
        MIME_TYPES.put("jpeg", "image/jpeg");
        MIME_TYPES.put("svg", "image/svg+xml; charset=utf-8");
        MIME_TYPES.put("ico", "image/x-icon");
        MIME_TYPES.put("woff2", "font/woff2");
        MIME_TYPES.put("woff", "font/woff");
        MIME_TYPES.put("ttf", "font/ttf");
    }

    public LocalAssetServer(AssetManager assetManager) {
        this(assetManager, null);
    }

    public LocalAssetServer(AssetManager assetManager, Context context) {
        this.assetManager = assetManager;
        this.prefs = context != null
                ? context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                : null;
        if (this.prefs != null) {
            this.savedServerUrl = cleanBaseUrl(this.prefs.getString(PREF_SERVER_URL, ""));
        }
    }

    public synchronized String getSavedServerUrl() {
        return savedServerUrl;
    }

    public synchronized void setSavedServerUrl(String url) {
        String clean = cleanBaseUrl(url);
        this.savedServerUrl = clean;
        if (this.prefs != null) {
            this.prefs.edit().putString(PREF_SERVER_URL, clean).apply();
        }
    }

    private static String cleanBaseUrl(String raw) {
        if (raw == null) return "";
        String s = raw.trim().replaceAll("/+$", "");
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) return "";
        return s;
    }

    public synchronized int start() throws IOException {
        if (running) return port;
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        IOException lastErr = null;
        for (int candidate : PREFERRED_PORTS) {
            try {
                serverSocket = new ServerSocket(candidate, 64, loopback);
                lastErr = null;
                break;
            } catch (IOException e) {
                lastErr = e;
            }
        }
        if (serverSocket == null) {
            throw (lastErr != null ? lastErr : new IOException("Unable to bind LocalAssetServer"));
        }

        port = serverSocket.getLocalPort();
        running = true;

        serverThread = new Thread(new ServerLoop(this));
        serverThread.setDaemon(true);
        serverThread.start();
        return port;
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (Exception ignored) {}
    }

    private static class ServerLoop implements Runnable {
        private final LocalAssetServer server;

        ServerLoop(LocalAssetServer server) {
            this.server = server;
        }

        @Override
        public void run() {
            while (server.running) {
                try {
                    Socket socket = server.serverSocket.accept();
                    new Thread(new ConnectionHandler(server, socket)).start();
                } catch (Exception e) {
                    if (!server.running) break;
                }
            }
        }
    }

    private static class ConnectionHandler implements Runnable {
        private final LocalAssetServer server;
        private final Socket socket;

        ConnectionHandler(LocalAssetServer server, Socket socket) {
            this.server = server;
            this.socket = socket;
        }

        @Override
        public void run() {
            try {
                socket.setSoTimeout(25000);
                InputStream in = socket.getInputStream();
                OutputStream out = socket.getOutputStream();

                String reqLine = readLineAscii(in);
                if (reqLine == null || reqLine.isEmpty()) {
                    return;
                }

                String[] parts = reqLine.split(" ");
                if (parts.length < 2) {
                    return;
                }

                String method = parts[0].trim().toUpperCase(Locale.US);
                String rawTarget = parts[1].trim();

                Map<String, String> headers = new HashMap<>();
                String headerLine;
                while ((headerLine = readLineAscii(in)) != null && !headerLine.isEmpty()) {
                    int colon = headerLine.indexOf(':');
                    if (colon > 0) {
                        String key = headerLine.substring(0, colon).trim().toLowerCase(Locale.US);
                        String val = headerLine.substring(colon + 1).trim();
                        headers.put(key, val);
                    }
                }

                byte[] reqBody = new byte[0];
                String clHeader = headers.get("content-length");
                if (clHeader != null) {
                    int contentLength = 0;
                    try {
                        contentLength = Integer.parseInt(clHeader.trim());
                    } catch (NumberFormatException ignored) {}
                    if (contentLength > 0) {
                        if (contentLength > MAX_BODY_BYTES) {
                            sendJson(out, 413, "{\"error\":\"Request body too large.\"}");
                            return;
                        }
                        reqBody = readExactBytes(in, contentLength);
                    }
                }

                if ("OPTIONS".equals(method)) {
                    String preflight = "HTTP/1.1 204 No Content\r\n"
                            + "Access-Control-Allow-Origin: *\r\n"
                            + "Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS\r\n"
                            + "Access-Control-Allow-Headers: Content-Type, Authorization, X-Vyro-Target, X-HTTP-Method-Override\r\n"
                            + "Access-Control-Max-Age: 86400\r\n"
                            + "Connection: close\r\n\r\n";
                    out.write(preflight.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    return;
                }

                String rawPath = rawTarget;
                int qIdx = rawPath.indexOf('?');
                if (qIdx >= 0) rawPath = rawPath.substring(0, qIdx);
                if (rawPath.startsWith("/")) rawPath = rawPath.substring(1);

                // Built-in Android APK control endpoints
                if ("_apk/status".equals(rawPath) && "GET".equals(method)) {
                    handleApkStatus(out);
                    return;
                }
                if ("_apk/server-url".equals(rawPath) && "POST".equals(method)) {
                    handleApkSaveServerUrl(out, reqBody);
                    return;
                }
                if ("_apk/discover".equals(rawPath) && "GET".equals(method)) {
                    handleApkDiscover(out);
                    return;
                }

                // Proxy /api/* requests to configured PC / remote VYRO server (never return plain 404 Not Found!)
                if ("api".equals(rawPath) || rawPath.startsWith("api/")) {
                    handleApiProxy(out, method, rawTarget, headers, reqBody);
                    return;
                }

                if (rawPath.isEmpty()) rawPath = "index.html";
                if (rawPath.contains("..")) {
                    sendText(out, 403, "Forbidden");
                    return;
                }

                byte[] data = readAsset("www/" + rawPath);
                if (data == null) {
                    data = readAsset(rawPath);
                }

                if (data != null) {
                    String mime = getMimeType(rawPath);
                    String header = "HTTP/1.1 200 OK\r\n"
                            + "Content-Type: " + mime + "\r\n"
                            + "Content-Length: " + data.length + "\r\n"
                            + "Access-Control-Allow-Origin: *\r\n"
                            + "Cache-Control: no-cache\r\n"
                            + "Connection: close\r\n\r\n";
                    out.write(header.getBytes(StandardCharsets.UTF_8));
                    out.write(data);
                } else {
                    sendText(out, 404, "Not Found");
                }
                out.flush();
            } catch (Exception ignored) {
            } finally {
                try { socket.close(); } catch (Exception ignored) {}
            }
        }

        private void handleApkStatus(OutputStream out) throws Exception {
            JSONObject obj = new JSONObject();
            obj.put("isApk", true);
            obj.put("port", server.port);
            obj.put("serverUrl", server.getSavedServerUrl());
            obj.put("localIps", new JSONArray(getLocalPrivateIps()));
            sendJson(out, 200, obj.toString());
        }

        private void handleApkSaveServerUrl(OutputStream out, byte[] bodyBytes) throws Exception {
            String rawJson = new String(bodyBytes, StandardCharsets.UTF_8);
            String url = "";
            if (!rawJson.trim().isEmpty()) {
                JSONObject reqJson = new JSONObject(rawJson);
                url = reqJson.optString("url", "");
            }
            server.setSavedServerUrl(url);
            JSONObject obj = new JSONObject();
            obj.put("ok", true);
            obj.put("serverUrl", server.getSavedServerUrl());
            sendJson(out, 200, obj.toString());
        }

        private void handleApkDiscover(OutputStream out) throws Exception {
            List<String> localIps = getLocalPrivateIps();
            Set<String> prefixes = new LinkedHashSet<>();
            for (String ip : localIps) {
                int lastDot = ip.lastIndexOf('.');
                if (lastDot > 0) {
                    prefixes.add(ip.substring(0, lastDot + 1));
                }
            }
            Set<String> ownIps = new LinkedHashSet<>(localIps);

            List<HostPort> targets = new ArrayList<>();
            // Android emulator host loopback alias
            for (int p : DISCOVERY_PORTS) {
                targets.add(new HostPort("10.0.2.2", p));
            }
            for (int p : DISCOVERY_PORTS) {
                for (String prefix : prefixes) {
                    for (int hostNum = 1; hostNum <= 254; hostNum++) {
                        String host = prefix + hostNum;
                        if (!ownIps.contains(host)) {
                            targets.add(new HostPort(host, p));
                        }
                    }
                }
            }

            List<JSONObject> found = new ArrayList<>();
            if (!targets.isEmpty()) {
                int workers = Math.min(64, Math.max(8, targets.size()));
                ExecutorService pool = Executors.newFixedThreadPool(workers);
                try {
                    List<Callable<JSONObject>> tasks = new ArrayList<>(targets.size());
                    for (final HostPort hp : targets) {
                        tasks.add(new Callable<JSONObject>() {
                            @Override
                            public JSONObject call() {
                                return probeVyroServer(hp.host, hp.port);
                            }
                        });
                    }
                    List<Future<JSONObject>> results = pool.invokeAll(tasks, 12, TimeUnit.SECONDS);
                    for (Future<JSONObject> f : results) {
                        try {
                            if (f.isDone() && !f.isCancelled()) {
                                JSONObject item = f.get();
                                if (item != null) found.add(item);
                            }
                        } catch (Exception ignored) {}
                    }
                } finally {
                    pool.shutdownNow();
                }
            }

            // Prefer port 3847 (installed/packaged server) ahead of 3899 (dev server)
            Collections.sort(found, new java.util.Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject a, JSONObject b) {
                    return Integer.compare(a.optInt("port", 9999), b.optInt("port", 9999));
                }
            });

            JSONObject resp = new JSONObject();
            resp.put("found", new JSONArray(found));
            resp.put("localIps", new JSONArray(localIps));
            sendJson(out, 200, resp.toString());
        }

        private void handleApiProxy(
                OutputStream out,
                String method,
                String rawTarget,
                Map<String, String> headers,
                byte[] reqBody
        ) throws IOException {
            String overrideTarget = cleanBaseUrl(headers.get("x-vyro-target"));
            String targetBase = !overrideTarget.isEmpty() ? overrideTarget : server.getSavedServerUrl();
            if (targetBase.isEmpty()) {
                sendJson(
                        out,
                        503,
                        "{\"error\":\"No VYRO server connected yet. Scan Wi-Fi or enter your VYRO server URL first.\",\"code\":\"NO_SERVER_CONFIGURED\"}"
                );
                return;
            }

            HttpURLConnection conn = null;
            try {
                String pathAndQuery = rawTarget.startsWith("/") ? rawTarget : "/" + rawTarget;
                URL url = new URL(targetBase + pathAndQuery);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(20000);
                conn.setUseCaches(false);
                conn.setInstanceFollowRedirects(false);

                try {
                    conn.setRequestMethod(method);
                } catch (ProtocolException pe) {
                    if ("PATCH".equals(method) || "PUT".equals(method) || "DELETE".equals(method)) {
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("X-HTTP-Method-Override", method);
                    } else {
                        throw pe;
                    }
                }

                if (headers.containsKey("content-type")) {
                    conn.setRequestProperty("Content-Type", headers.get("content-type"));
                }
                if (headers.containsKey("authorization")) {
                    conn.setRequestProperty("Authorization", headers.get("authorization"));
                }
                if (headers.containsKey("cookie")) {
                    conn.setRequestProperty("Cookie", headers.get("cookie"));
                }

                if (!"GET".equals(method) && !"HEAD".equals(method) && reqBody.length > 0) {
                    conn.setDoOutput(true);
                    OutputStream upOut = conn.getOutputStream();
                    upOut.write(reqBody);
                    upOut.flush();
                    upOut.close();
                }

                int status = conn.getResponseCode();
                String respType = conn.getContentType();
                if (respType == null || respType.isEmpty()) {
                    respType = "application/json; charset=utf-8";
                }
                InputStream respIn = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] respBytes = respIn != null ? readAllBytes(respIn) : new byte[0];

                String respHeader = "HTTP/1.1 " + status + " " + statusText(status) + "\r\n"
                        + "Content-Type: " + respType + "\r\n"
                        + "Content-Length: " + respBytes.length + "\r\n"
                        + "Access-Control-Allow-Origin: *\r\n"
                        + "Cache-Control: no-store\r\n"
                        + "Connection: close\r\n\r\n";
                out.write(respHeader.getBytes(StandardCharsets.UTF_8));
                if (respBytes.length > 0) {
                    out.write(respBytes);
                }
                out.flush();
            } catch (Exception e) {
                JSONObject errObj = new JSONObject();
                try {
                    errObj.put("error", "Could not reach VYRO server at " + targetBase + ". Make sure VYRO is running on your PC or check your server URL.");
                    errObj.put("code", "SERVER_UNREACHABLE");
                } catch (Exception ignored) {}
                sendJson(out, 502, errObj.toString());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        private byte[] readAsset(String path) {
            try (InputStream is = server.assetManager.open(path)) {
                return readAllBytes(is);
            } catch (Exception e) {
                return null;
            }
        }

        private static String getMimeType(String path) {
            int dot = path.lastIndexOf('.');
            if (dot >= 0) {
                String ext = path.substring(dot + 1).toLowerCase(Locale.US);
                String mime = MIME_TYPES.get(ext);
                if (mime != null) return mime;
            }
            return "application/octet-stream";
        }
    }

    private static class HostPort {
        final String host;
        final int port;

        HostPort(String host, int port) {
            this.host = host;
            this.port = port;
        }
    }

    private static JSONObject probeVyroServer(String host, int port) {
        Socket tcp = null;
        HttpURLConnection conn = null;
        try {
            tcp = new Socket();
            tcp.connect(new InetSocketAddress(host, port), 220);
            tcp.close();
            tcp = null;

            String baseUrl = "http://" + host + ":" + port;
            conn = (HttpURLConnection) new URL(baseUrl + "/api/health").openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(600);
            conn.setReadTimeout(800);
            int code = conn.getResponseCode();
            if (code != 200) return null;

            String body = new String(readAllBytes(conn.getInputStream()), StandardCharsets.UTF_8);
            JSONObject health = new JSONObject(body);
            if (!health.optBoolean("ok") || !"VYRO".equalsIgnoreCase(health.optString("appName"))) {
                return null;
            }

            JSONObject result = new JSONObject();
            result.put("url", baseUrl);
            result.put("host", host);
            result.put("port", port);
            result.put("version", health.optString("version", ""));
            result.put("appName", health.optString("appName", "VYRO"));
            return result;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (tcp != null) {
                try { tcp.close(); } catch (Exception ignored) {}
            }
            if (conn != null) conn.disconnect();
        }
    }

    private static List<String> getLocalPrivateIps() {
        List<String> ips = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces == null) return ips;
            while (ifaces.hasMoreElements()) {
                NetworkInterface iface = ifaces.nextElement();
                try {
                    if (!iface.isUp() || iface.isLoopback()) continue;
                } catch (Exception ignored) {
                    continue;
                }
                Enumeration<InetAddress> addrs = iface.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (!(addr instanceof Inet4Address) || addr.isLoopbackAddress() || addr.isLinkLocalAddress()) {
                        continue;
                    }
                    String ip = addr.getHostAddress();
                    if (isPrivateIpv4(ip)) {
                        ips.add(ip);
                    }
                }
            }
        } catch (Exception ignored) {}
        return ips;
    }

    private static boolean isPrivateIpv4(String ip) {
        if (ip == null) return false;
        if (ip.startsWith("192.168.") || ip.startsWith("10.")) return true;
        if (ip.startsWith("172.")) {
            String[] parts = ip.split("\\.");
            if (parts.length >= 2) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 16 && second <= 31;
                } catch (NumberFormatException ignored) {}
            }
        }
        return false;
    }

    private static String readLineAscii(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        int b;
        boolean sawAny = false;
        while ((b = in.read()) != -1) {
            sawAny = true;
            if (b == '\n') break;
            if (b != '\r') bos.write(b);
        }
        if (!sawAny && bos.size() == 0) return null;
        return new String(bos.toByteArray(), StandardCharsets.US_ASCII);
    }

    private static byte[] readExactBytes(InputStream in, int length) throws IOException {
        byte[] buf = new byte[length];
        int offset = 0;
        while (offset < length) {
            int n = in.read(buf, offset, length - offset);
            if (n < 0) break;
            offset += n;
        }
        if (offset == length) return buf;
        byte[] trimmed = new byte[offset];
        System.arraycopy(buf, 0, trimmed, 0, offset);
        return trimmed;
    }

    private static byte[] readAllBytes(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    private static void sendJson(OutputStream out, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        String header = "HTTP/1.1 " + status + " " + statusText(status) + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }

    private static void sendText(OutputStream out, int status, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        String header = "HTTP/1.1 " + status + " " + statusText(status) + "\r\n"
                + "Content-Type: text/plain; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }

    private static String statusText(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 409: return "Conflict";
            case 413: return "Payload Too Large";
            case 502: return "Bad Gateway";
            case 503: return "Service Unavailable";
            default: return "OK";
        }
    }
}
