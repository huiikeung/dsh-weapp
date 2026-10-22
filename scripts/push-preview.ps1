# 微信小程序 CLI 工具函数
# 用法:
#   .\scripts\push-preview.ps1              # 单次预览推送
#   .\scripts\push-preview.ps1 -Auto        # 开启自动预览
#   .\scripts\push-preview.ps1 -Off         # 关闭自动预览
#   .\scripts\push-preview.ps1 -Project     # 显示项目信息

$CLI = "D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
$Project = "D:\Other\P-Program\dsh-weapp\miniprogram"

function Test-Cli {
    $result = & $CLI islogin 2>$null | Select-String -Pattern "login.*true"
    return $result -ne $null
}

function Show-Info {
    Write-Host "=== Mini Program Info ===" -ForegroundColor Cyan
    Write-Host "Project: $Project"
    Write-Host "CLI:     $CLI"
    Write-Host "Login:   $(if (Test-Cli) { 'OK' } else { 'NOT LOGGED IN' })" -ForegroundColor $(if (Test-Cli) { 'Green' } else { 'Red' })
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  push-preview.ps1              # Push preview"
    Write-Host "  push-preview.ps1 -Auto        # Enable auto-preview"
    Write-Host "  push-preview.ps1 -Off         # Disable auto-preview"
}

if ($args[0] -eq "--project" -or $args[0] -eq "-Project") {
    Show-Info
    exit 0
}

if ($args[0] -eq "--auto" -or $args[0] -eq "-Auto") {
    if (-not (Test-Cli)) {
        Write-Host "ERROR: Not logged in to WeChat DevTools" -ForegroundColor Red
        exit 1
    }
    Write-Host "Enabling auto-preview..." -ForegroundColor Cyan
    # Capture output but suppress stderr from cli.bat
    $output = & $CLI auto-preview --enable --project $Project 2>$null
    Write-Host $output
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Auto-preview enabled. Changes will push automatically on save." -ForegroundColor Green
    }
    exit $LASTEXITCODE
}

if ($args[0] -eq "--off" -or $args[0] -eq "-Off") {
    if (-not (Test-Cli)) {
        Write-Host "ERROR: Not logged in to WeChat DevTools" -ForegroundColor Red
        exit 1
    }
    Write-Host "Disabling auto-preview..." -ForegroundColor Cyan
    $output = & $CLI auto-preview --disable --project $Project 2>$null
    Write-Host $output
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Auto-preview disabled." -ForegroundColor Green
    }
    exit $LASTEXITCODE
}

# Default: push preview once
if (-not (Test-Cli)) {
    Write-Host "ERROR: Not logged in. Please login manually first." -ForegroundColor Red
    exit 1
}

Write-Host "Pushing preview to connected device..." -ForegroundColor Cyan
$output = & $CLI preview --project $Project 2>$null
Write-Host $output
Write-Host ""
Write-Host "If QR code shown above, scan with WeChat to preview." -ForegroundColor Yellow
