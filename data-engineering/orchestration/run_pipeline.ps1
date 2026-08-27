$ErrorActionPreference = "Stop"

$CONTAINER = "stellar-marketpay-postgres-1"
$USER = "stellarwork"
$DATABASE = "stellarwork"

Write-Host ""
Write-Host "========================================"
Write-Host " Stellar MarketPay Data Pipeline"
Write-Host "========================================"
Write-Host ""

function Run-SQL($file) {
    Write-Host "Running: $file"

    Get-Content $file |
        docker exec -i $CONTAINER psql -U $USER -d $DATABASE

    if ($LASTEXITCODE -ne 0) {
        throw "Pipeline failed at: $file"
    }

    Write-Host "SUCCESS: $file"
    Write-Host ""
}

# ============================================================
# SILVER
# ============================================================

Run-SQL ".\data-engineering\silver\sql\01_create_silver.sql"

# ============================================================
# GOLD
# ============================================================

Run-SQL ".\data-engineering\gold\sql\01_create_gold.sql"

# ============================================================
# DATA QUALITY
# ============================================================

Run-SQL ".\data-engineering\quality\01_data_quality.sql"

# ============================================================
# PIPELINE COMPLETE
# ============================================================

Write-Host ""
Write-Host "========================================"
Write-Host " PIPELINE COMPLETED SUCCESSFULLY"
Write-Host "========================================"
Write-Host ""