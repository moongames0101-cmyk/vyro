package app.vyro.chat;

import android.content.res.AssetManager;
import java.io.*;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;

public class LocalAssetServer {
    private final AssetManager assetManager;
    private ServerSocket serverSocket;
    private Thread serverThread;
    private int port = 0;
    private volatile boolean running = false;

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
        this.assetManager = assetManager;
    }

    public synchronized int start() throws IOException {
        if (running) return port;
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
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
                    new Thread(new ConnectionHandler(server.assetManager, socket)).start();
                } catch (Exception e) {
                    if (!server.running) break;
                }
            }
        }
    }

    private static class ConnectionHandler implements Runnable {
        private final AssetManager assetManager;
        private final Socket socket;

        ConnectionHandler(AssetManager assetManager, Socket socket) {
            this.assetManager = assetManager;
            this.socket = socket;
        }

        @Override
        public void run() {
            try {
                InputStream in = socket.getInputStream();
                OutputStream out = socket.getOutputStream();
                BufferedReader reader = new BufferedReader(new InputStreamReader(in));
                String reqLine = reader.readLine();
                if (reqLine == null) {
                    socket.close();
                    return;
                }

                String[] parts = reqLine.split(" ");
                if (parts.length < 2) {
                    socket.close();
                    return;
                }

                String rawPath = parts[1];
                int qIdx = rawPath.indexOf('?');
                if (qIdx >= 0) rawPath = rawPath.substring(0, qIdx);
                if (rawPath.startsWith("/")) rawPath = rawPath.substring(1);
                if (rawPath.isEmpty()) rawPath = "index.html";

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
                    out.write(header.getBytes("UTF-8"));
                    out.write(data);
                } else {
                    String nf = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found";
                    out.write(nf.getBytes("UTF-8"));
                }
                out.flush();
            } catch (Exception ignored) {
            } finally {
                try { socket.close(); } catch (Exception ignored) {}
            }
        }

        private byte[] readAsset(String path) {
            try {
                InputStream is = assetManager.open(path);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) {
                    bos.write(buf, 0, n);
                }
                is.close();
                return bos.toByteArray();
            } catch (Exception e) {
                return null;
            }
        }

        private String getMimeType(String path) {
            int dot = path.lastIndexOf('.');
            if (dot >= 0) {
                String ext = path.substring(dot + 1).toLowerCase();
                String mime = MIME_TYPES.get(ext);
                if (mime != null) return mime;
            }
            return "application/octet-stream";
        }
    }
}
