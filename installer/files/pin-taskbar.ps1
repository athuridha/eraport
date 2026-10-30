# Sematkan pintasan ke bilah tugas (taskbar) memakai verb Shell.
# Windows tidak menyediakan API resmi untuk pinning diam-diam, jadi cara ini
# best-effort: cari verb yang cocok ("Pin to taskbar" / "Sematkan ke bilah tugas"
# / locale lain), jalankan, kalau tidak ada biarkan senyap — pintasan Start Menu
# dan desktop tetap terpasang.
param(
	[Parameter(Mandatory = $true)]
	[string]$ShortcutPath
)

$ErrorActionPreference = 'SilentlyContinue'

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
	exit 0
}

try {
	$dir = Split-Path -LiteralPath $ShortcutPath
	$leaf = Split-Path -LiteralPath $ShortcutPath -Leaf
	$shell = New-Object -ComObject Shell.Application
	$folder = $shell.Namespace($dir)
	if (-not $folder) { exit 0 }
	$item = $folder.ParseName($leaf)
	if (-not $item) { exit 0 }

	foreach ($verb in $item.Verbs()) {
		$name = [string]$verb.Name
		# ASCII saja: file ini tanpa BOM, Windows PowerShell 5.1 membacanya sebagai
		# ANSI — karakter non-ASCII di regex merusak parse saat dibaca `-File`.
		if ($name -match 'task ?bar|bilah tugas|sematkan.*tugas') {
			$verb.DoIt()
			exit 0
		}
	}
} catch {
	# best-effort: gagal mempatok tidak boleh menggagalkan instalasi
}
exit 0
