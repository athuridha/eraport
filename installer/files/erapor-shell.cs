// erapor-shell.cs — Desktop shell untuk e-Rapor SMK Pratama Mulya.
//
// Host WebView2 (Edge) yang membungkus server lokal SvelteKit sehingga aplikasi
// terasa native: satu jendela dengan ikon sendiri, tanpa jendela terminal dan
// tanpa membuka tab browser.
//
// Prinsip:
//   - Tidak mengelola siklus hidup server. Peluncur (start-erapor-pmk.mjs)
//     tetap yang menyalakan/menjaga server; shell hanya menunggu lalu tampil.
//   - Bila server sudah hidup, shell langsung connect (start ulang cepat).
//   - Bila server belum hidup, shell menyalakan scripts/start-build.mjs sendiri
//     (fallback ketika aplikasi dijalankan tanpa peluncur).
//   - Runtime WebView2: pakai folder WebviewRuntime\<versi> di samping exe bila
//     ada (ditanam installer), kalau tidak pakai runtime terinstall di sistem.
//   - Tanpa runtime WebView2 → fallback mode browser (--app= pada Chrome/Edge).
//   - Target _blank / tautan luar (Drive, dsb.) dibuka di browser sistem.
//   - URL cetak/PDF (/cetak/, *.pdf) dibuka di jendela aplikasi kedua, bukan
//     browser, supaya mencetak tetap dalam aplikasi.
//
// Dikompilasi oleh scripts/prepare-windows.mjs memakai csc.exe .NET Framework 4
// (selalu ada di Windows 10/11) + interop resmi Microsoft.Web.WebView2.
//
// Mode:
//   e-Rapor.exe                    → jendela aplikasi (default)
//   e-Rapor.exe --browser          → langsung mode browser
//   e-Rapor.exe "http://..."       → jendela penampil (boleh banyak jendela)
//   e-Rapor.exe --port 3000        → port server (default 3000)
//   e-Rapor.exe --quiet            → tanpa dialog; log saja (untuk skrip)

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ERaporShell
{
    internal static class Program
    {
        internal const string AppTitle = "e-Rapor SMK Pratama Mulya";
        internal const string MutexName = "erapor-pmk-shell-window";

        [STAThread]
        static int Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;

            bool browserMode = false;
            bool quiet = false;
            int port = 3000;
            string urlArg = null;

            foreach (string raw in args)
            {
                string a = raw ?? string.Empty;
                if (a == "--browser")
                {
                    browserMode = true;
                }
                else if (a == "--quiet")
                {
                    quiet = true;
                }
                else if (a.StartsWith("--port=", StringComparison.OrdinalIgnoreCase))
                {
                    int p;
                    if (int.TryParse(a.Substring(7), out p) && p > 0 && p < 65536) port = p;
                }
                else if (a == "--port")
                {
                    // nilai dibaca di iterasi berikutnya lewat loop terpisah di bawah
                }
                else if (a.Length > 0 && a[0] != '-' && IsHttpUrl(a))
                {
                    urlArg = a;
                }
                else if (a.Length > 0 && char.IsDigit(a[0]))
                {
                    int p;
                    if (int.TryParse(a, out p) && p > 0 && p < 65536) port = p;
                }
            }

            // Nilai setelah "--port" (bentuk dua token).
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--port")
                {
                    int p;
                    if (int.TryParse(args[i + 1], out p) && p > 0 && p < 65536) port = p;
                }
            }

            string baseUrl = "http://127.0.0.1:" + port.ToString();
            string target = urlArg ?? (baseUrl + "/login");
            bool isViewer = urlArg != null;

            Log("Shell start: mode=" + (browserMode ? "browser" : "window") +
                " port=" + port.ToString() + " target=" + target +
                (isViewer ? " (viewer)" : ""));

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (browserMode)
            {
                EnsureServerOrPrompt(baseUrl, target, quiet);
                if (LaunchBrowser(target, quiet)) return 0;
                return 1;
            }

            // Satu jendela utama per sesi (jendela penampil boleh banyak).
            if (!isViewer)
            {
                bool createdNew;
                using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
                {
                    if (!createdNew)
                    {
                        Log("Shell sudah berjalan; fokuskan jendela lama.");
                        BringExistingToFront();
                        return 0;
                    }
                    return RunWindow(target, port, baseUrl, quiet);
                }
            }
            return RunWindow(target, port, baseUrl, quiet);
        }

        static void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
        {
            Log("Unhandled exception: " + (e.ExceptionObject == null ? "?" : e.ExceptionObject.ToString()));
        }

        static int RunWindow(string target, int port, string baseUrl, bool quiet)
        {
            ShellWindow window = new ShellWindow(target, port, baseUrl, quiet);
            Application.Run(window);
            return 0;
        }

        /// <summary>Tunggu server hidup; bila belum, coba nyalakan lewat start-build.mjs.</summary>
        internal static void EnsureServerOrPrompt(string baseUrl, string target, bool quiet)
        {
            if (WaitForServer(baseUrl + "/login", 6000))
            {
                Log("Server sudah berjalan di " + baseUrl);
                return;
            }

            TryStartBuiltServer();
            if (WaitForServer(baseUrl + "/login", 45000))
            {
                Log("Server dinyalakan oleh shell di " + baseUrl);
                return;
            }

            if (quiet)
            {
                Log("Server tidak merespons setelah batas waktu (quiet mode).");
                return;
            }

            while (true)
            {
                string message = "Gagal terhubung ke server e-Rapor di " + baseUrl + "\n\n" +
                    "Kemungkinan penyebab:\n" +
                    "  - Server sedang berjalan dan belum siap\n" +
                    "  - Port dipakai aplikasi lain\n\n" +
                    "Log aplikasi: %LOCALAPPDATA%\\erapor-pmk-data\\logs\\erapor-pmk.log\n" +
                    "Log shell:    %LOCALAPPDATA%\\erapor-pmk-data\\logs\\shell.log";
                DialogResult dr = MessageBox.Show(
                    message, AppTitle,
                    MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button1);
                if (dr != DialogResult.Retry)
                {
                    Log("Pengguna membatalkan menunggu server.");
                    return;
                }
                TryStartBuiltServer();
                if (WaitForServer(baseUrl + "/login", 45000))
                {
                    Log("Server hidup setelah percobaan ulang.");
                    return;
                }
            }
        }

        static void TryStartBuiltServer()
        {
            try
            {
                string appDir = AppDir();
                string script = Path.Combine(appDir, "start-build.mjs");
                if (!File.Exists(script)) script = Path.Combine(appDir, "build", "index.js");
                if (!File.Exists(script))
                {
                    Log("Tidak menemukan skrip server di " + appDir);
                    return;
                }
                string node = Path.Combine(appDir, "runtime", "node", "node.exe");
                if (!File.Exists(node)) node = "node.exe";
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = node;
                psi.Arguments = "\"" + script + "\"";
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process.Start(psi);
                Log("Server dinyalakan: " + node + " \"" + script + "\"");
            }
            catch (Exception err)
            {
                Log("Gagal menyalakan server: " + err.Message);
            }
        }

        // ------------------------------------------------------------------
        // Jendela utama
        // ------------------------------------------------------------------

        internal class ShellWindow : Form
        {
            readonly string _target;
            readonly int _port;
            readonly string _baseUrl;
            readonly bool _quiet;
            WebView2 _webView;
            Label _status;

            public ShellWindow(string target, int port, string baseUrl, bool quiet)
            {
                _target = target;
                _port = port;
                _baseUrl = baseUrl;
                _quiet = quiet;

                Text = AppTitle;
                Icon = LoadAppIcon();
                StartPosition = FormStartPosition.CenterScreen;
                Size = new Size(1280, 800);
                MinimumSize = new Size(1000, 640);

                _status = new Label();
                _status.Dock = DockStyle.Fill;
                _status.TextAlign = System.Drawing.ContentAlignment.MiddleCenter;
                _status.Text = "Menyiapkan e-Rapor...\n\nServer lokal berjalan di latar belakang.\nJendela ini akan menampilkan aplikasi sebentar lagi.";
                Controls.Add(_status);

                Shown += OnShownAsync;
                FormClosed += OnWindowClosed;
            }

            void OnWindowClosed(object sender, FormClosedEventArgs e)
            {
                // Server sengaja tetap hidup di latar belakang (detached) supaya
                // start ulang jendela cepat; peluncur/log memegang siklus hidupnya.
                Log("Jendela ditutup.");
            }

            async void OnShownAsync(object sender, EventArgs e)
            {
                try
                {
                    EnsureServerOrPrompt(_baseUrl, _target, _quiet);
                    if (!WaitForServer(_baseUrl + "/login", 5000))
                    {
                        // Server tetap tidak merespons: buka di browser saja.
                        Log("Server tidak hidup; fallback browser dari jendela.");
                        LaunchBrowser(_target, _quiet);
                        BeginInvoke((MethodInvoker)delegate { Close(); });
                        return;
                    }

                    string runtimeDir = WebView2Locator.FindBundledRuntime();
                    string userData = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "erapor-pmk", "shell-profile");
                    Directory.CreateDirectory(userData);
                    Log("WebView2 runtime: " + (runtimeDir ?? "(terinstall di sistem)"));

                    CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions();
                    CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(
                        runtimeDir, userData, options);

                    WebView2 wv = new WebView2();
                    wv.Dock = DockStyle.Fill;
                    await wv.EnsureCoreWebView2Async(env);
                    _webView = wv;
                    ConfigureWebView(wv.CoreWebView2);

                    Controls.Remove(_status);
                    _status.Dispose();
                    _status = null;
                    Controls.Add(wv);
                    wv.Source = new Uri(_target);
                    Log("Jendela aplikasi siap: " + _target);
                }
                catch (Exception err)
                {
                    Log("WebView2 gagal dipakai (" + err.Message + "); fallback browser.");
                    if (!_quiet)
                    {
                        MessageBox.Show(
                            "Komponen WebView2 tidak tersedia, aplikasi dibuka di browser.\n\n" +
                            "Detail: " + err.Message,
                            AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    LaunchBrowser(_target, true);
                    BeginInvoke((MethodInvoker)delegate { Close(); });
                }
            }

            void ConfigureWebView(CoreWebView2 core)
            {
                core.DocumentTitleChanged += delegate(object s, object e)
                {
                    try
                    {
                        string title = core.DocumentTitle;
                        Text = string.IsNullOrEmpty(title) ? AppTitle : title;
                    }
                    catch
                    {
                        Text = AppTitle;
                    }
                };

                // Tautan _blank / unduhan halaman → browser sistem (bukan jendela baru
                // aplikasi), kecuali PDF/preview cetak yang tetap di dalam aplikasi.
                core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e)
                {
                    try
                    {
                        e.Handled = true;
                        string url = e.Uri;
                        if (IsPrintableUrl(url))
                        {
                            LaunchViewerWindow(url);
                        }
                        else
                        {
                            LaunchBrowser(url, true);
                        }
                    }
                    catch (Exception err)
                    {
                        Log("Gagal membuka tautan baru: " + err.Message);
                    }
                };

                // window.close() dari aplikasi (mis. halaman cetak selesai) → tutup jendela.
                core.WindowCloseRequested += delegate(object s, object e)
                {
                    try { BeginInvoke((MethodInvoker)delegate { Close(); }); }
                    catch { }
                };

                core.ProcessFailed += delegate(object s, CoreWebView2ProcessFailedEventArgs e)
                {
                    Log("WebView2 process failed: " + e.ProcessFailedKind + " / " + e.Reason);
                };
            }

            static Icon LoadAppIcon()
            {
                string appDir = AppDir();
                string[] candidates = new string[]
                {
                    Path.Combine(appDir, "e-Rapor.ico"),
                    Path.Combine(appDir, "erapor-pmk.ico"),
                    Path.Combine(appDir, "static", "favicon.ico")
                };
                foreach (string c in candidates)
                {
                    try
                    {
                        if (File.Exists(c)) return new Icon(c);
                    }
                    catch { }
                }
                return null;
            }
        }

        // ------------------------------------------------------------------
        // Util
        // ------------------------------------------------------------------

        internal static string AppDir()
        {
            try
            {
                return Path.GetDirectoryName(Application.ExecutablePath);
            }
            catch
            {
                return Directory.GetCurrentDirectory();
            }
        }

        internal static bool IsHttpUrl(string value)
        {
            if (value == null) return false;
            return value.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                || value.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>URL PDF / pratinjau cetak → tampil di jendela aplikasi kedua.</summary>
        internal static bool IsPrintableUrl(string url)
        {
            if (url == null) return false;
            string lower = url.ToLowerInvariant();
            if (lower.EndsWith(".pdf")) return true;
            if (lower.Contains("/cetak/")) return true;
            if (lower.Contains(".pdf")) return true;
            return false;
        }

        internal static void LaunchViewerWindow(string url)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = Application.ExecutablePath;
                psi.Arguments = "\"" + url + "\"";
                psi.UseShellExecute = true;
                Process.Start(psi);
                Log("Jendela penampil dibuka: " + url);
            }
            catch (Exception err)
            {
                Log("Gagal membuka jendela penampil: " + err.Message);
                LaunchBrowser(url, true);
            }
        }

        internal static bool LaunchBrowser(string url, bool quiet)
        {
            string browser = FindBrowser();
            if (browser == null)
            {
                Log("Tidak ada browser Chromium/Edge di lokasi standar.");
                if (!quiet)
                {
                    MessageBox.Show(
                        "Tidak menemukan Google Chrome/Edge di komputer ini.\n" +
                        "Pasang salah satunya, atau jalankan ulang installer e-Rapor " +
                        "supaya WebView2 Runtime terpasang.",
                        AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return false;
            }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = browser;
                psi.Arguments = "--app=" + "\"" + url + "\"";
                psi.UseShellExecute = true;
                Process.Start(psi);
                Log("Browser dibuka (mode app): " + browser + " " + url);
                return true;
            }
            catch (Exception err)
            {
                Log("Gagal menjalankan browser " + browser + ": " + err.Message);
                if (!quiet)
                {
                    MessageBox.Show("Gagal membuka browser: " + err.Message,
                        AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return false;
            }
        }

        /// <summary>Chrome/Edge/Brave/Vivaldi di lokasi standar, urutan preferensi.</summary>
        internal static string FindBrowser()
        {
            string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            string pf = Environment.GetEnvironmentVariable("ProgramFiles");
            string lad = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] roots = new string[] { pf86, pf, lad };
            string[][] browsers = new string[][]
            {
                new string[] { "Google\\Chrome\\Application", "chrome.exe" },
                new string[] { "Microsoft\\Edge\\Application", "msedge.exe" },
                new string[] { "Microsoft\\EdgeWebView\\Application", "msedgewebview2.exe" },
                new string[] { "Vivaldi\\Application", "vivaldi.exe" },
                new string[] { "BraveSoftware\\Brave-Browser\\Application", "brave.exe" }
            };
            foreach (string root in roots)
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                foreach (string[] b in browsers)
                {
                    string candidate = Path.Combine(root, b[0], b[1]);
                    if (File.Exists(candidate)) return candidate;
                }
            }
            return null;
        }

        static void BringExistingToFront()
        {
            try
            {
                Process current = Process.GetCurrentProcess();
                Process[] others = Process.GetProcessesByName(current.ProcessName);
                foreach (Process p in others)
                {
                    if (p.Id == current.Id) continue;
                    IntPtr handle = IntPtr.Zero;
                    try { handle = p.MainWindowHandle; } catch { }
                    if (handle != IntPtr.Zero)
                    {
                        ShowWindow(handle, 9); // SW_RESTORE
                        SetForegroundWindow(handle);
                        break;
                    }
                }
                foreach (Process p in others)
                {
                    try { if (p.Id != current.Id) p.Dispose(); } catch { }
                }
            }
            catch (Exception err)
            {
                Log("Gagal memfokuskan jendela lama: " + err.Message);
            }
        }

        internal static bool WaitForServer(string url, int timeoutMs)
        {
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                if (ProbeServer(url)) return true;
                Thread.Sleep(500);
            }
            return ProbeServer(url);
        }

        internal static bool ProbeServer(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 3000;
                req.ReadWriteTimeout = 3000;
                req.AllowAutoRedirect = true;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return (int)resp.StatusCode < 500;
                }
            }
            catch (WebException wex)
            {
                HttpWebResponse resp = wex.Response as HttpWebResponse;
                if (resp != null) return (int)resp.StatusCode < 500;
                return false;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Cari runtime WebView2 yang ditanam installer (WebviewRuntime\&lt;versi&gt;).</summary>
        internal static class WebView2Locator
        {
            internal static string FindBundledRuntime()
            {
                try
                {
                    string root = Path.Combine(AppDir(), "WebviewRuntime");
                    if (!Directory.Exists(root)) return null;
                    string best = null;
                    Version bestVersion = null;
                    foreach (string dir in Directory.GetDirectories(root))
                    {
                        if (!File.Exists(Path.Combine(dir, "msedgewebview2.exe"))) continue;
                        string name = Path.GetFileName(dir);
                        Version v;
                        try
                        {
                            v = new Version(name);
                        }
                        catch
                        {
                            v = null;
                        }
                        if (best == null || (v != null && (bestVersion == null || v > bestVersion)))
                        {
                            best = dir;
                            bestVersion = v;
                        }
                    }
                    return best;
                }
                catch
                {
                    return null;
                }
            }
        }

        internal static void Log(string message)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "erapor-pmk-data", "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(
                    Path.Combine(dir, "shell.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine);
            }
            catch { }
        }

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
}
