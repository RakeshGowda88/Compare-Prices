# Runs the price collector from this PC, then pushes prices.json to GitHub.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File <path>\run-local.ps1
Set-Location (Split-Path $PSScriptRoot -Parent)
git pull --rebase
node scripts/collect-prices.mjs
git add prices.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "Update prices (local run)"
    git pull --rebase
    git push
}
