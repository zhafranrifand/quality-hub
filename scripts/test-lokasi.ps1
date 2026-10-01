param(
  [Parameter(Mandatory = $true)]
  [string]$Email,
  [string[]]$TestFiles = @()
)

$ErrorActionPreference = 'Stop'
$lokasiSecure = Read-Host -AsSecureString 'LOKASI password'
$lokasiPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($lokasiSecure)
$lokasiPreviousEmail = $env:LOKASI_EMAIL
$lokasiPreviousPassword = $env:LOKASI_PASSWORD
$lokasiExitCode = 1

try {
  $env:LOKASI_EMAIL = $Email
  $env:LOKASI_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($lokasiPtr)
  Push-Location (Split-Path -Parent $PSScriptRoot)
  try {
    & npx playwright test --config playwright.lokasi.config.ts @TestFiles
    $lokasiExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  $env:LOKASI_EMAIL = $lokasiPreviousEmail
  $env:LOKASI_PASSWORD = $lokasiPreviousPassword
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($lokasiPtr)
}

exit $lokasiExitCode
