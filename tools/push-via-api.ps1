<#
.SYNOPSIS
    通过 GitHub API 推送文件到仓库（绕过 git push 静默失败）。

.DESCRIPTION
    某些 Windows 环境下 `git push` 会静默失败（exit 128、无任何输出），
    本脚本用 GitHub REST API 作为替代推送通道。

    默认行为：把所有变更合并为 **一个 commit**（而不是每文件一个 commit）。

    仓库为空时先用 Contents API 播下第一个 commit（Git Data API 在空仓库上
    不可用，会报 409 `Git Repository is empty`），随后用 Git Data API 一次性
    提交全部文件。

.PARAMETER Repo
    仓库全名，如 Lijiashuo936/resume-autofill-extension

.PARAMETER Branch
    目标分支，默认 main

.PARAMETER Root
    本地项目根目录，默认脚本所在目录的上一级

.PARAMETER Message
    commit message。**注意**：PowerShell 5.1 把含中文的命令行参数传给 .ps1 时
    可能被替换成 `?`，因此推荐用 -MessageFile 从 UTF-8 文件读取。

.PARAMETER MessageFile
    从 UTF-8 文件读取 commit message（推荐，避免中文丢失）

.PARAMETER Squash
    丢弃远端历史，把所有文件重建为一个干净的根提交（仅适用于新仓库，
    会 force 覆盖远端分支）

.PARAMETER DryRun
    只列出将要上传的文件，不实际推送

.EXAMPLE
    powershell -File tools\push-via-api.ps1 -DryRun
    powershell -File tools\push-via-api.ps1
    powershell -File tools\push-via-api.ps1 -MessageFile .commitmsg.txt
    powershell -File tools\push-via-api.ps1 -Squash

.NOTES
    前置条件：
      1. 已安装 GitHub CLI (`winget install --id GitHub.cli -e`)
      2. 已完成登录 (`gh auth login --hostname github.com --git-protocol https --web`)
      3. 网络可访问 api.github.com

    本文件必须保存为 UTF-8 **with BOM**：PowerShell 5.1 会把无 BOM 的 UTF-8
    文件按 ANSI/GBK 解码，中文注释被解成乱码后会破坏脚本词法分析，导致脚本
    把自己的源码当字符串回显、逻辑完全不执行。
#>
param(
    [string]$Repo = "Lijiashuo936/resume-autofill-extension",
    [string]$Branch = "main",
    [string]$Root,
    [string]$Message = "",
    [string]$MessageFile,
    [switch]$Squash,
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"

if (-not $Root) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$DefaultMessage = @"
feat: 简历飞填 v1.1.0 首次发布

- README 重写为「产品 + 商业」文档，新增 BD 商业化章节（市场规模 / 变现路径 / 合作方向 / 增长渠道 / 核心指标 / 风险应对）
- 新增 examples/resume-sample.json：虚构示例简历，可直接导入体验
- 新增 tools/push-via-api.ps1：API 推送通道，绕过本机 git push 静默失败
- tools/ 归整 PDF/DOCX 提取与图标生成脚本
- 新增 .gitignore：排除 resume-data.json 等含个人信息的文件
- 新增 MIT LICENSE
"@

# ---------- 排除规则：这些文件永不入库 ----------
$ExcludeNames = @(
    "resume-data.json",
    "package.json",
    "package-lock.json",
    ".commitmsg.txt"
)
$ExcludeDirs = @(".git", "node_modules", "dist", "build", "release", ".vscode", ".idea")
$ExcludeExt  = @(".log", ".zip", ".crx", ".pem", ".tmp")

function Get-UploadList {
    param([string]$Base)
    $result = @()
    $items = Get-ChildItem $Base -Recurse -File -Force -ErrorAction SilentlyContinue
    foreach ($it in $items) {
        $rel = $it.FullName.Substring($Base.Length).TrimStart("\", "/") -replace "\\", "/"

        $skip = $false
        foreach ($d in $ExcludeDirs) {
            if ($rel -match "(^|/)$([regex]::Escape($d))/") { $skip = $true }
        }
        if ($ExcludeNames -contains $it.Name) { $skip = $true }
        if ($ExcludeExt -contains $it.Extension.ToLower()) { $skip = $true }
        if (-not $skip) { $result += @{ Rel = $rel; Full = $it.FullName } }
    }
    return $result | Sort-Object { $_.Rel }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-Sha {
    param([string]$JsonText)
    try { return (($JsonText | ConvertFrom-Json).sha) } catch { return $null }
}

# git/ref 接口把 sha 放在 .object.sha，与其它接口不同
function Get-RefSha {
    param([string]$JsonText)
    try {
        $o = $JsonText | ConvertFrom-Json
        if ($o.object.sha) { return $o.object.sha }
        if ($o.sha) { return $o.sha }
        return $null
    } catch { return $null }
}

# ---------- 前置检查 ----------
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    Write-Host "[X] 未找到 gh 命令。请先安装：" -ForegroundColor Red
    Write-Host "    winget install --id GitHub.cli -e" -ForegroundColor Yellow
    exit 1
}

$auth = (gh auth status 2>&1 | Out-String)
if ($auth -match "not logged" -or $auth -match "HTTP 4") {
    Write-Host "[X] GitHub CLI 未登录。请先执行：" -ForegroundColor Red
    Write-Host "    gh auth login --hostname github.com --git-protocol https --web" -ForegroundColor Yellow
    exit 1
}

# ---------- commit message ----------
$commitMsg = $DefaultMessage
if ($Message -ne "") { $commitMsg = $Message }
if ($MessageFile -and (Test-Path $MessageFile)) {
    $commitMsg = [System.IO.File]::ReadAllText($MessageFile, [System.Text.Encoding]::UTF8)
}
$commitMsg = $commitMsg -replace "^\uFEFF", ""
$commitMsg = $commitMsg.TrimEnd()

$files = Get-UploadList -Base $Root
$api = "/repos/$Repo"

Write-Host ""
Write-Host "仓库   : $Repo" -ForegroundColor Cyan
Write-Host "分支   : $Branch" -ForegroundColor Cyan
Write-Host "根目录 : $Root" -ForegroundColor Cyan
Write-Host "文件数 : $($files.Count)" -ForegroundColor Cyan
Write-Host ("模式   : " + $(if ($Squash) { "Squash（重建为单个根提交）" } else { "增量（合并为一个 commit）" })) -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    foreach ($f in $files) { Write-Host ("  [dry] " + $f.Rel) }
    Write-Host ""
    Write-Host "DryRun 结束，未推送。" -ForegroundColor Yellow
    exit 0
}

$tmp = Join-Path $env:TEMP ("ghpush-" + [Guid]::NewGuid().ToString("N") + ".json")

function Invoke-GhApiPost {
    param([string]$Endpoint, [string]$JsonBody, [string]$Method = "POST")
    Write-Utf8NoBom -Path $tmp -Content $JsonBody
    $res = (& gh api --method $Method $Endpoint --input $tmp 2>&1 | Out-String)
    return $res
}

# ---------- 1. 判断远端分支是否存在 ----------
$headRes = & gh api "$api/git/ref/heads/$Branch" 2>&1 | Out-String
$headSha = Get-RefSha $headRes
$baseTree = $null
if ($headSha) {
    $cRes = & gh api "$api/git/commits/$headSha" 2>&1 | Out-String
    try { $baseTree = ($cRes | ConvertFrom-Json).tree.sha } catch { }
    Write-Host "  远端已有分支，HEAD = $($headSha.Substring(0,8))" -ForegroundColor DarkGray
} else {
    Write-Host "  远端分支不存在（空仓库）" -ForegroundColor DarkGray
}

# ---------- 2. 空仓库：先用 Contents API 播种 ----------
if (-not $headSha) {
    $seed = $files[0]
    $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($seed.Full))
    $body = @{ message = "chore: initialize repository"; content = $b64; branch = $Branch } |
            ConvertTo-Json -Compress -Depth 5

    # 若该文件已存在（罕见），必须带上 sha 才能覆盖
    $existRes = & gh api "$api/contents/$($seed.Rel)?ref=$Branch" 2>&1 | Out-String
    try {
        $existSha = ($existRes | ConvertFrom-Json).sha
        if ($existSha -match "^[0-9a-f]{40}$") { $body = @{ message = "chore: initialize repository"; content = $b64; branch = $Branch; sha = $existSha } | ConvertTo-Json -Compress -Depth 5 }
    } catch { }

    $r = Invoke-GhApiPost -Endpoint "$api/contents/$($seed.Rel)" -JsonBody $body -Method "PUT"
    $seedSha = $null
    try { $seedSha = ($r | ConvertFrom-Json).commit.sha } catch { }
    if (-not $seedSha) {
        Write-Host ("  [FAIL] 播种失败 -> " + ($r -replace "\r?\n"," ")) -ForegroundColor Red
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "  已播种：$($seed.Rel)" -ForegroundColor DarkGray

    $headRes = & gh api "$api/git/ref/heads/$Branch" 2>&1 | Out-String
    $headSha = Get-RefSha $headRes
}

# ---------- 3. 为每个文件创建 blob ----------
Write-Host ""
Write-Host "  创建 blobs..." -ForegroundColor DarkGray
$entries = @()
$fail = 0
foreach ($f in $files) {
    $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($f.Full))
    $body = @{ content = $b64; encoding = "base64" } | ConvertTo-Json -Compress
    $r = Invoke-GhApiPost -Endpoint "$api/git/blobs" -JsonBody $body
    $sha = Get-Sha $r
    if ($sha -match "^[0-9a-f]{40}$") {
        $entries += @{ path = $f.Rel; mode = "100644"; type = "blob"; sha = $sha }
    } else {
        $fail++
        Write-Host ("  [FAIL] " + $f.Rel) -ForegroundColor Red
    }
}
Write-Host ("  blob 完成：" + $entries.Count + " 个") -ForegroundColor DarkGray

# ---------- 4. 创建 tree ----------
$treeBody = @{ tree = $entries }
if ($baseTree -and -not $Squash) { $treeBody["base_tree"] = $baseTree }
$treeJson = $treeBody | ConvertTo-Json -Compress -Depth 8
$tr = Invoke-GhApiPost -Endpoint "$api/git/trees" -JsonBody $treeJson
$treeSha = Get-Sha $tr
if (-not ($treeSha -match "^[0-9a-f]{40}$")) {
    Write-Host ("  [FAIL] 创建 tree 失败 -> " + ($tr -replace "\r?\n"," ")) -ForegroundColor Red
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "  tree = $($treeSha.Substring(0,8))" -ForegroundColor DarkGray

# ---------- 5. 创建 commit ----------
$commitBody = @{ message = [string]$commitMsg; tree = $treeSha }
if (-not $Squash -and $headSha) { $commitBody["parents"] = @($headSha) }
$commitJson = $commitBody | ConvertTo-Json -Compress -Depth 6
$cr = Invoke-GhApiPost -Endpoint "$api/git/commits" -JsonBody $commitJson
$commitSha = Get-Sha $cr
if (-not ($commitSha -match "^[0-9a-f]{40}$")) {
    Write-Host ("  [FAIL] 创建 commit 失败 -> " + ($cr -replace "\r?\n"," ")) -ForegroundColor Red
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "  commit = $($commitSha.Substring(0,8))" -ForegroundColor DarkGray

# ---------- 6. 更新分支引用 ----------
if ($headSha) {
    $refBody = @{ sha = $commitSha; force = [bool]$Squash } | ConvertTo-Json -Compress
    $rr = Invoke-GhApiPost -Endpoint "$api/git/refs/heads/$Branch" -JsonBody $refBody -Method "PATCH"
} else {
    $refBody = @{ ref = "refs/heads/$Branch"; sha = $commitSha } | ConvertTo-Json -Compress
    $rr = Invoke-GhApiPost -Endpoint "$api/git/refs" -JsonBody $refBody
}
try {
    $obj = $rr | ConvertFrom-Json
    if ($obj.object.sha) { Write-Host "  分支 $Branch -> $($obj.object.sha.ToString().Substring(0,8))" -ForegroundColor DarkGray }
} catch { }

Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# ---------- 7. 校验 ----------
$vRes = & gh api "$api/git/trees/$Branch`?recursive=1" 2>&1 | Out-String
$remoteCount = 0
try { $remoteCount = (($vRes | ConvertFrom-Json).tree | Where-Object { $_.type -eq "blob" } | Measure-Object).Count } catch { }

Write-Host ""
Write-Host ("结果：本地 $($files.Count) 个文件 / 远端 $remoteCount 个文件 / blob 失败 $fail") `
    -ForegroundColor $(if ($fail -eq 0 -and $remoteCount -ge $entries.Count) { "Green" } else { "Yellow" })
Write-Host ("仓库地址：https://github.com/$Repo")
Write-Host ""
Write-Host "commit message：" -ForegroundColor DarkGray
($commitMsg -split "`n") | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor DarkGray }

if ($fail -gt 0) { exit 1 }
