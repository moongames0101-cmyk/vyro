param(
    [string]$SourcePath = "C:\Users\moong\.gemini\antigravity\brain\8f5c3e0a-86e9-4956-b6a1-42b5181df1eb\.user_uploaded\media_1795566718396_b60c7065.jpg",
    [string]$OutDir = "assets"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

Copy-Item -Path $SourcePath -Destination (Join-Path $OutDir "logo.jpg") -Force

$src = [System.Drawing.Image]::FromFile($SourcePath)

function Save-ResizedPng {
    param([System.Drawing.Image]$Image, [int]$Size, [string]$DestPath)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = [Math]::Max(2, [int]($Size * 0.20))
    $d = $r * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.SetClip($path)
    $g.DrawImage($Image, 0, 0, $Size, $Size)
    $path.Dispose()
    $g.Dispose()

    $bmp.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Save-ResizedPng -Image $src -Size 1024 -DestPath (Join-Path $OutDir "logo.png")
Save-ResizedPng -Image $src -Size 512  -DestPath (Join-Path $OutDir "icon-512.png")
Save-ResizedPng -Image $src -Size 192  -DestPath (Join-Path $OutDir "icon-192.png")
Save-ResizedPng -Image $src -Size 180  -DestPath (Join-Path $OutDir "apple-touch-icon.png")

$sizes = @(256, 128, 64, 48, 32, 16)
$pngFrames = @()
foreach ($s in $sizes) {
    $tmpPath = Join-Path $OutDir "tmp_$s.png"
    Save-ResizedPng -Image $src -Size $s -DestPath $tmpPath
    $bytes = [System.IO.File]::ReadAllBytes($tmpPath)
    Remove-Item $tmpPath -Force
    $pngFrames += ,@($s, $bytes)
}

$src.Dispose()

$icoPath = Join-Path $OutDir "icon.ico"
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$pngFrames.Count)

$offset = 6 + (16 * $pngFrames.Count)
foreach ($frame in $pngFrames) {
    $sz = $frame[0]
    $data = $frame[1]
    $dimByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $bw.Write($dimByte)
    $bw.Write($dimByte)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$data.Length)
    $bw.Write([UInt32]$offset)
    $offset += $data.Length
}

foreach ($frame in $pngFrames) {
    $bw.Write([byte[]]$frame[1])
}

[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()

Write-Output "Icons generated successfully in $OutDir"
