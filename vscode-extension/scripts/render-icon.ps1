Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform($size / 24, $size / 24)

$rounded = [System.Drawing.Drawing2D.GraphicsPath]::new()
$rounded.AddArc(1, 1, 6, 6, 180, 90)
$rounded.AddArc(17, 1, 6, 6, 270, 90)
$rounded.AddArc(17, 17, 6, 6, 0, 90)
$rounded.AddArc(1, 17, 6, 6, 90, 90)
$rounded.CloseFigure()
$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.PointF]::new(2, 1), [System.Drawing.PointF]::new(22, 23),
  [System.Drawing.Color]::FromArgb(19, 29, 55), [System.Drawing.Color]::FromArgb(56, 35, 100))
$graphics.FillPath($background, $rounded)

function Draw-Line($x1, $y1, $x2, $y2, $color, $width) {
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($color), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($pen, [single]$x1, [single]$y1, [single]$x2, [single]$y2)
  $pen.Dispose()
}
function Draw-Node($x, $y, $color) {
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($color))
  $graphics.FillEllipse($brush, [single]($x - 1.7), [single]($y - 1.7), [single]3.4, [single]3.4)
  $brush.Dispose()
}

Draw-Line 10.1 10.2 6.0 6.6 '#73DCFF' 1.3
Draw-Line 13.9 10.2 18.0 6.6 '#73DCFF' 1.3
Draw-Line 13.9 13.8 18.0 17.4 '#E8B76A' 1.3
Draw-Line 4.3 19.4 9.5 14.2 '#E8F6FF' 1.7
Draw-Node 5.1 5.8 '#73DCFF'
Draw-Node 18.9 5.8 '#73DCFF'
Draw-Node 18.9 18.3 '#E8B76A'

$diamond = [System.Drawing.Drawing2D.GraphicsPath]::new()
$diamond.AddPolygon([System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(12, 8.5),
  [System.Drawing.PointF]::new(15.5, 12),
  [System.Drawing.PointF]::new(12, 15.5),
  [System.Drawing.PointF]::new(8.5, 12)))
$hub = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#EDF7FF'))
$graphics.FillPath($hub, $diamond)

$output = Join-Path (Split-Path $PSScriptRoot -Parent) 'media/agents.png'
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$hub.Dispose()
$diamond.Dispose()
$background.Dispose()
$rounded.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
Write-Output $output
