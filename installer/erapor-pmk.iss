#define AppName "e-Rapor SMK Pratama Mulya - Aplikasi administrasi guru terpadu"
#define AppVersion "0.1.6"
#define StagePath "..\\dist\\windows\\stage\\erapor-pmk"

[Setup]
AppId={{06E10F9F-0AD2-4F31-A64B-7C3B36F2D0D6}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher="e-Rapor SMK Pratama Mulya"
AppPublisherURL="https://github.com/athuridha/eraport"
; Install under the current user's Local AppData so admin privileges are not required
DefaultDirName={localappdata}\erapor-pmk
DefaultGroupName=e-Rapor SMK Pratama Mulya
DisableProgramGroupPage=yes
OutputDir=..\dist\windows
OutputBaseFilename=ERaporPMKSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
; Artwork wizard (dirender dari installer/assets/wizard.html lewat paket script logo:wizard)
WizardImageFile=assets\wizard-large.bmp
WizardSmallImageFile=assets\wizard-small.bmp
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Do not require administrator privileges when installing to per-user LocalAppData
PrivilegesRequired=lowest
; Aplikasi ini adalah server lokal: saat upgrade, node.exe sering masih memegang
; berkas (terutama node_modules\@libsql\win32-x64-msvc\index.node). Tanpa dua baris
; di bawah, installer berhenti di tengah ("DeleteFile failed; code 5"), rollback,
; dan menyisakan instalasi campuran lama+baru yang tidak bisa dijalankan.
; CloseApplications=force menutup proses yang terdeteksi RestartManager tanpa
; bertanya (instalasi /SILENT tidak bisa menampilkan dialog); RestartApplications=no
; karena aplikasi tidak boleh dihidupkan lagi diam-diam. Untuk berkas yang tetap
; terkunci (addon native sering tak terdeteksi RestartManager), flag restartreplace
; pada [Files] menjadwalkan penggantian setelah reboot, bukan menggagalkan install.
CloseApplications=force
RestartApplications=no
UninstallDisplayIcon={app}\erapor-pmk.ico
VersionInfoVersion={#AppVersion}
SetupIconFile={#StagePath}\erapor-pmk.ico
LicenseFile="..\LICENSE"
; Code signing configuration (commented out by default)
; Uncomment and configure these lines if you want Inno Setup to sign the installer
; SignTool=custom "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d "Administrasi guru terpadu Installer" /f "installer\cert\codesign.pfx" /p "YOUR_PASSWORD" $f
; SignedUninstaller=yes

[Tasks]
; Windows tidak mengizinkan pinning taskbar diam-diam lewat API resmi, jadi
; langkah terakhir instalasi menjalankan pin-taskbar.ps1 (verb Shell, lihat
; [Run] dan [Code]). Bisa dicentang/tidak saat wizard.
Name: "taskbarpin"; Description: "Sematkan aplikasi ke Bilah Tugas (Taskbar)"; GroupDescription: "Pintasan tambahan:"

[Files]
Source:"{#StagePath}\\*"; DestDir:"{app}"; Excludes:".env"; Flags: ignoreversion restartreplace recursesubdirs createallsubdirs
; .env staged by pnpm package:win memuat kredensial cloud. onlyifdoesntexist
; menjaga .env milik pengguna tetap utuh saat upgrade.
Source:"{#StagePath}\\.env"; DestDir:"{app}"; Flags: ignoreversion restartreplace onlyifdoesntexist
; Selalu diperbarui tiap instalasi: pelengkap .env (kredensial cloud terbaru).
; start-build.mjs hanya memakai nilainya untuk kunci yang belum ada di .env.
Source:"{#StagePath}\\.env"; DestDir:"{app}"; DestName:".env.default"; Flags: ignoreversion restartreplace
Source:"files\\start-erapor-pmk.mjs"; DestDir:"{app}"; Flags: ignoreversion restartreplace
; Pemilih runtime: pakai {app}\runtime\node\node.exe bila ada, jika tidak node dari PATH.
Source:"files\\run-node.cmd"; DestDir:"{app}"; Flags: ignoreversion restartreplace
; Penyemat pintasan ke bilah tugas (dijalankan [Run] bila tugas taskbarpin dipilih).
Source:"files\\pin-taskbar.ps1"; DestDir:"{app}\\scripts"; Flags: ignoreversion restartreplace
; Penyedia runtime Node.js (diunduh hanya bila mesin belum punya Node di PATH).
Source:"scripts\\ensure-node.ps1"; DestDir:"{app}\\scripts"; Flags: ignoreversion restartreplace
Source:"scripts\\ensure-node.cmd"; DestDir:"{app}\\scripts"; Flags: ignoreversion restartreplace
Source:"..\dist\windows\vc_redist.x64.exe"; DestDir:"{tmp}"; Flags: ignoreversion deleteafterinstall
; Bootstrapper WebView2 Runtime: dipasang [Run] hanya bila mesin belum punya
; runtime Edge WebView2; tanpa itu shell jatuh ke mode browser.
Source:"..\dist\windows\MicrosoftEdgeWebview2Setup.exe"; DestDir:"{tmp}"; Flags: ignoreversion deleteafterinstall

[Run]
; Pasang WebView2 Runtime HANYA bila mesin belum punya. Bootstrapper Microsoft
; yang dijalankan saat runtime sudah terinstall justru gagal dengan kode
; 0x80040c01 dan menampilkan dialog "There was a problem installing" — padahal
; tidak ada yang rusak (runtime memang sudah ada). Karena itu periksa registry
; dulu (WebView2RuntimeInstalled di [Code]) sebelum menjalankan bootstrapper.
Filename:"{cmd}"; Parameters:"/c if exist ""{tmp}\MicrosoftEdgeWebview2Setup.exe"" ""{tmp}\MicrosoftEdgeWebview2Setup.exe"" /install /silent /norestart"; StatusMsg:"Memeriksa WebView2 Runtime..."; Flags: runhidden waituntilterminated; Check: not WebView2RuntimeInstalled
; Dijalankan lebih dulu: menyiapkan runtime Node.js lokal bila mesin belum punya.
Filename:"{cmd}"; Parameters:"/c ""{app}\scripts\ensure-node.cmd"""; WorkingDir:"{app}"; StatusMsg:"Menyiapkan runtime Node.js..."; Flags: runhidden waituntilterminated
Filename:"{cmd}"; Parameters:"/c ""{app}\run-node.cmd"" scripts\migrate-installed-db.mjs"; WorkingDir:"{app}"; StatusMsg:"Menjalankan migrasi database (drizzle-kit) pada mesin ini..."; Flags: runhidden waituntilterminated
; Terakhir: sematkan ke taskbar. [Icons] sudah dibuat sebelum [Run], jadi
; pintasan Start Menu sudah bisa ditemukan script. Gagal mempatok tidak
; menggagalkan instalasi (script selalu exit 0).
Filename:"{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters:"-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\pin-taskbar.ps1"" ""{autoprograms}\erapor-pmk\e-Rapor SMK Pratama Mulya.lnk"""; StatusMsg:"Menyematkan pintasan ke bilah tugas..."; Flags: runhidden waituntilterminated; Check: TaskbarPinSelected

[UninstallDelete]
; Salinan pintasan yang dipaten ke taskbar disimpan Explorer di folder ini;
; hapus agar tidak meninggalkan shortcut mati setelah uninstall.
Type: files; Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\e-Rapor SMK Pratama Mulya.lnk"

[Icons]
; Pintasan utama: jendela aplikasi native (e-Rapor.exe, WebView2) bila shell
; berhasil dikompilasi saat packaging; bila tidak, jatuh ke peluncur lama yang
; membuka browser.
Name:"{autoprograms}\erapor-pmk\e-Rapor SMK Pratama Mulya"; Filename:"{app}\e-Rapor.exe"; WorkingDir:"{app}"; IconFilename:"{app}\erapor-pmk.ico"; Comment:"Administrasi guru terpadu"; Check: ShellExeExists
Name:"{autoprograms}\erapor-pmk\e-Rapor SMK Pratama Mulya"; Filename:"{app}\\run-node.cmd"; Parameters:"start-erapor-pmk.mjs"; WorkingDir:"{app}"; IconFilename:"{app}\erapor-pmk.ico"; Check: not ShellExeExists
Name:"{autoprograms}\erapor-pmk\e-Rapor (Mode Browser)"; Filename:"{app}\e-Rapor.exe"; Parameters:"--browser"; WorkingDir:"{app}"; IconFilename:"{app}\erapor-pmk.ico"; Check: ShellExeExists
Name:"{autodesktop}\e-Rapor SMK Pratama Mulya"; Filename:"{app}\e-Rapor.exe"; WorkingDir:"{app}"; IconFilename:"{app}\erapor-pmk.ico"; Comment:"Administrasi guru terpadu"; Check: ShellExeExists
Name:"{autodesktop}\e-Rapor SMK Pratama Mulya"; Filename:"{app}\\run-node.cmd"; Parameters:"start-erapor-pmk.mjs"; WorkingDir:"{app}"; IconFilename:"{app}\erapor-pmk.ico"; Check: not ShellExeExists

[Code]

function WebView2RuntimeInstalled: Boolean;
var
	Pv: string;
begin
	// Kunci EdgeUpdate milik WebView2 Runtime ({F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}).
	// Install machine-wide ditulis ke view 32-bit (WOW6432Node), per-user ke HKCU.
	Result :=
		RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Pv) or
		RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Pv) or
		RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Pv);
	if Result then
		Log('WebView2 Runtime sudah terinstall (pv=' + Pv + '); bootstrapper dilewati.')
	else
		Log('WebView2 Runtime belum ada; bootstrapper akan dipasang.');
end;

function ShellExeExists: Boolean;
begin
	// Shell desktop hasil kompilasi packaging (scripts/prepare-windows.mjs).
	// Bila tidak ada (kompilasi dilewati), pintasan jatuh ke peluncur browser.
	Result := FileExists(ExpandConstant('{app}\e-Rapor.exe'));
end;

function TaskbarPinSelected: Boolean;
begin
	Result := WizardIsTaskSelected('taskbarpin');
end;

function VCRedistNeedsInstall: Boolean;
var
	Version: string;
begin
	Result := True;
	if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64', 'Version', Version) then
	begin
		Log('VC++ 2015-2022 Redistributable (x64) sudah terinstall: ' + Version);
		Result := False;
	end
	else
	begin
		Log('VC++ 2015-2022 Redistributable (x64) belum terinstall.');
	end;
end;

procedure InstallVcRedist;
var
	ResultCode: Integer;
	RedistPath: string;
begin
	if not VCRedistNeedsInstall then
	begin
		Log('Melewati instalasi VC++ Redistributable (sudah terinstall).');
		Exit;
	end;

	RedistPath := ExpandConstant('{tmp}\vc_redist.x64.exe');
	if not FileExists(RedistPath) then
	begin
		Log('File VC++ redistributable tidak ditemukan di ' + RedistPath);
		Exit;
	end;

	Log('Menginstall Microsoft Visual C++ Redistributable 2015-2022...');
	if ShellExec('runas', RedistPath, '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
	begin
		if ResultCode = 0 then
			Log('VC++ Redistributable berhasil diinstall.')
		else
			Log(Format('VC++ Redistributable selesai dengan kode: %d', [ResultCode]));
	end
	else
	begin
		Log(Format('Gagal menjalankan VC++ Redistributable installer. Kode: %d', [ResultCode]));
	end;
end;

procedure StopRunningApp;
var
	ResultCode: Integer;
	AppPath, Script: string;
begin
	AppPath := ExpandConstant('{app}');
	// CloseApplications/RestartManager tidak mengenali node.exe yang memegang
	// node_modules\@libsql\win32-x64-msvc\index.node, sehingga upgrade saat aplikasi
	// masih hidup gagal dengan "DeleteFile failed; code 5" dan instalasi campur.
	// Jadi hentikan sendiri proses node milik aplikasi ini.
	// Proses server dijalankan oleh peluncur sebagai `node start-build.mjs` (tanpa
	// path aplikasi di command line), jadi pencocokan lewat path saja tidak cukup.
	Script :=
		'Get-CimInstance Win32_Process | Where-Object { (' +
		'($_.Name -eq ''node.exe'') -and (' +
		'$_.CommandLine -like ''*' + AppPath + '*'' -or ' +
		'$_.CommandLine -like ''*start-build.mjs*'' -or ' +
		'$_.CommandLine -like ''*start-erapor-pmk.mjs*'')) -or ' +
		'($_.Name -eq ''e-Rapor.exe'') } | ' +
		'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
	if Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -Command "' + Script + '"',
		'', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
		Log(Format('StopRunningApp selesai (kode %d)', [ResultCode]))
	else
		Log('StopRunningApp: gagal menjalankan powershell');
	// beri waktu handle file dilepas sebelum penyalinan dimulai
	Sleep(2500);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
	EnvPath, DbPath, DbDir, S, SrcDb, LogDir, LogFile, SoundDir: string;
begin
	if CurStep = ssInstall then
	begin
		StopRunningApp;
	end
	else if CurStep = ssPostInstall then
	begin
		InstallVcRedist;
		DbPath := ExpandConstant('{localappdata}\erapor-pmk-data\database.sqlite3');
		DbDir := ExtractFileDir(DbPath);
		if not DirExists(DbDir) then
			ForceDirectories(DbDir);
			// If the user doesn't already have a DB in their user state, copy the packaged one
			SrcDb := ExpandConstant('{localappdata}\erapor-pmk\data\database.sqlite3');
			if (not FileExists(DbPath)) and FileExists(SrcDb) then
			begin
				if not CopyFile(SrcDb, DbPath, False) then
					Log(Format('Failed to copy initial database from %s to %s', [SrcDb, DbPath]));
			end;

			// Ensure log directory and empty log file exist
			LogDir := ExpandConstant('{localappdata}\erapor-pmk-data\logs');
			if not DirExists(LogDir) then
				ForceDirectories(LogDir);
			LogFile := LogDir + '\\erapor-pmk.log';
			if not FileExists(LogFile) then
				SaveStringToFile(LogFile, '', False);
		// Ensure sounds directory exists
			SoundDir := ExpandConstant('{localappdata}\erapor-pmk-data\sounds');
			if not DirExists(SoundDir) then
				ForceDirectories(SoundDir);

		// Preserve an existing .env across upgrades — it may hold custom
		// photo/sounds overrides, a rotated cloud token, or point at a moved
		// data root. Only a fresh install writes the initial .env here.
		// Catatan: .env bawaan (berisi kredensial cloud) sudah dipasang dari
		// [Files], jadi blok ini hanya jaring pengaman kalau .env hilang.
		// Uploads/sounds are NOT pinned: they follow the data root
		// automatically (default <root>/uploads and <root>/sounds), and the
		// root itself lives in the launcher override file
		// (%LOCALAPPDATA%\erapor-pmk-data\data-root.txt), not in .env.
		EnvPath := ExpandConstant('{app}\.env');
		if FileExists(EnvPath) then
			Log(Format('Menjaga .env yang sudah ada: %s', [EnvPath]))
		else
		begin
			S := 'DB_URL="file:' + DbPath + '"' + #13#10 + 'BODY_SIZE_LIMIT=5M';
			if SaveStringToFile(EnvPath, S, False) then
				Log(Format('Wrote .env to %s', [EnvPath]))
			else
				Log(Format('Failed to write .env to %s', [EnvPath]));
		end;
	end;
end;