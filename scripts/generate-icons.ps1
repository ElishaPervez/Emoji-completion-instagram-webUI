Add-Type -AssemblyName System.Drawing

function Add-RoundedRectPath {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [float]$X,
    [float]$Y,
    [float]$W,
    [float]$H,
    [float]$R
  )

  if ($R -lt 0) { $R = 0 }
  if ($R -gt ($W / 2)) { $R = $W / 2 }
  if ($R -gt ($H / 2)) { $R = $H / 2 }

  $d = $R * 2
  if ($R -eq 0) {
    $Path.AddRectangle([System.Drawing.RectangleF]::new($X, $Y, $W, $H))
    return
  }

  $Path.AddArc($X, $Y, $d, $d, 180, 90)
  $Path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $Path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $Path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $Path.CloseFigure()
}

function New-EmojiCompleterIcon {
  param(
    [int]$Size,
    [string]$OutPath
  )

  $bmp = [System.Drawing.Bitmap]::new($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = $Size * 0.06
  $bodyW = $Size - (2 * $pad)
  $bodyH = $Size - (2 * $pad)
  $radius = $Size * 0.24

  $bodyPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectPath -Path $bodyPath -X $pad -Y $pad -W $bodyW -H $bodyH -R $radius

  $bg1 = [System.Drawing.Color]::FromArgb(255, 23, 41, 74)
  $bg2 = [System.Drawing.Color]::FromArgb(255, 36, 88, 161)
  $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, 0),
    [System.Drawing.PointF]::new($Size, $Size),
    $bg1,
    $bg2
  )
  $g.FillPath($bgBrush, $bodyPath)

  $ringPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(120, 255, 255, 255), [Math]::Max(1, $Size * 0.03))
  $g.DrawPath($ringPen, $bodyPath)

  $faceRect = [System.Drawing.RectangleF]::new($Size * 0.30, $Size * 0.18, $Size * 0.56, $Size * 0.56)
  $faceBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 252, 204, 86))
  $g.FillEllipse($faceBrush, $faceRect)

  $eyeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 52, 36, 28))
  $eyeSize = [Math]::Max(1, $Size * 0.062)
  $g.FillEllipse($eyeBrush, $Size * 0.46, $Size * 0.37, $eyeSize, $eyeSize)
  $g.FillEllipse($eyeBrush, $Size * 0.63, $Size * 0.37, $eyeSize, $eyeSize)

  $smilePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 52, 36, 28), [Math]::Max(1, $Size * 0.045))
  $smilePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $smilePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($smilePen, $Size * 0.46, $Size * 0.43, $Size * 0.24, $Size * 0.21, 12, 156)

  $colonBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 131, 236, 255))
  $dotSize = [Math]::Max(1, $Size * 0.1)
  $g.FillEllipse($colonBrush, $Size * 0.14, $Size * 0.36, $dotSize, $dotSize)
  $g.FillEllipse($colonBrush, $Size * 0.14, $Size * 0.56, $dotSize, $dotSize)

  $glowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(150, 131, 236, 255), [Math]::Max(1, $Size * 0.02))
  $g.DrawArc($glowPen, $Size * 0.09, $Size * 0.30, $Size * 0.22, $Size * 0.42, 250, 220)

  $dir = [System.IO.Path]::GetDirectoryName($OutPath)
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $glowPen.Dispose()
  $colonBrush.Dispose()
  $smilePen.Dispose()
  $eyeBrush.Dispose()
  $faceBrush.Dispose()
  $ringPen.Dispose()
  $bgBrush.Dispose()
  $bodyPath.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$iconsDir = Join-Path $root 'icons'

New-EmojiCompleterIcon -Size 16 -OutPath (Join-Path $iconsDir 'icon16.png')
New-EmojiCompleterIcon -Size 32 -OutPath (Join-Path $iconsDir 'icon32.png')
New-EmojiCompleterIcon -Size 48 -OutPath (Join-Path $iconsDir 'icon48.png')
New-EmojiCompleterIcon -Size 128 -OutPath (Join-Path $iconsDir 'icon128.png')

Write-Output 'Generated icons: 16, 32, 48, 128'
