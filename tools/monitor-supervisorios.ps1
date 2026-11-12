param(
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$TimeoutMilliseconds = 8000
$IntervalSeconds = 1800

$utilsPath = Join-Path $PSScriptRoot '..\js\utils.js'
if (-not (Test-Path -LiteralPath $utilsPath -PathType Leaf)) {
  throw "Não encontrei a configuração do Supabase em $utilsPath."
}

$utils = Get-Content -LiteralPath $utilsPath -Raw
$urlMatch = [regex]::Match($utils, "const SUPA_URL = '([^']+)';")
$keyMatch = [regex]::Match($utils, "const SUPA_KEY = '([^']+)';")
if (-not $urlMatch.Success -or -not $keyMatch.Success) {
  throw 'Não foi possível ler a configuração pública do Supabase em js\utils.js.'
}

$script:SupabaseUrl = $urlMatch.Groups[1].Value.TrimEnd('/')
$script:SupabaseKey = $keyMatch.Groups[1].Value
$stateDirectory = Join-Path $env:LOCALAPPDATA 'Clemar\Monitor'
$refreshTokenPath = Join-Path $stateDirectory 'refresh-token.dpapi'
$logPath = Join-Path $stateDirectory 'monitor.log'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null

function Write-MonitorLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

function ConvertTo-PlainText {
  param([Parameter(Mandatory = $true)][System.Security.SecureString]$Value)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Save-RefreshToken {
  param([Parameter(Mandatory = $true)][string]$Token)

  $secureToken = ConvertTo-SecureString -String $Token -AsPlainText -Force
  $encryptedToken = ConvertFrom-SecureString -SecureString $secureToken
  Set-Content -LiteralPath $refreshTokenPath -Value $encryptedToken -Encoding ASCII
}

function Get-AccessToken {
  if (Test-Path -LiteralPath $refreshTokenPath -PathType Leaf) {
    $encryptedToken = Get-Content -LiteralPath $refreshTokenPath -Raw
    $secureToken = ConvertTo-SecureString -String $encryptedToken
    try {
      $refreshToken = ConvertTo-PlainText -Value $secureToken
      $session = Invoke-RestMethod `
        -Method Post `
        -Uri "$script:SupabaseUrl/auth/v1/token?grant_type=refresh_token" `
        -Headers @{ apikey = $script:SupabaseKey } `
        -ContentType 'application/json' `
        -Body (@{ refresh_token = $refreshToken } | ConvertTo-Json -Compress) `
        -ErrorAction Stop
    } catch {
      throw "Não foi possível renovar a sessão do monitor. Execute o script manualmente após remover o arquivo de sessão em $refreshTokenPath. Detalhe: $($_.Exception.Message)"
    } finally {
      $refreshToken = $null
      $secureToken.Dispose()
    }

    Save-RefreshToken -Token $session.refresh_token
    return $session.access_token
  }

  $email = Read-Host 'E-mail de uma conta aprovada no mapa'
  $securePassword = Read-Host 'Senha da conta' -AsSecureString
  $password = ConvertTo-PlainText -Value $securePassword
  try {
    $session = Invoke-RestMethod `
      -Method Post `
      -Uri "$script:SupabaseUrl/auth/v1/token?grant_type=password" `
      -Headers @{ apikey = $script:SupabaseKey } `
      -ContentType 'application/json' `
      -Body (@{ email = $email; password = $password } | ConvertTo-Json -Compress) `
      -ErrorAction Stop
  } finally {
    $password = $null
    $securePassword.Dispose()
  }

  Save-RefreshToken -Token $session.refresh_token
  Write-MonitorLog 'Sessão autenticada. O token de renovação foi protegido para este usuário do Windows.'
  return $session.access_token
}

function Test-SupervisorioPort {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port
  )

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync($HostName, $Port)
    if (-not $connection.Wait($TimeoutMilliseconds)) {
      return $false
    }

    $connection.GetAwaiter().GetResult()
    return $true
  } catch [System.AggregateException] {
    return $false
  } catch [System.Net.Sockets.SocketException] {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Invoke-MonitorCycle {
  $accessToken = Get-AccessToken
  $headers = @{
    apikey        = $script:SupabaseKey
    Authorization = "Bearer $accessToken"
  }
  $select = 'id,nome,supervisorio_url'
  $queryUrl = "$script:SupabaseUrl/rest/v1/obras_mapa?select=$select&supervisorio_monitorar=eq.true"
  $obras = @(Invoke-RestMethod -Method Get -Uri $queryUrl -Headers $headers -ErrorAction Stop)

  if ($obras.Count -eq 0) {
    Write-MonitorLog 'Nenhuma obra com monitoramento habilitado.'
    return
  }

  foreach ($obra in $obras) {
    try {
      $uri = $null
      if (-not [Uri]::TryCreate([string]$obra.supervisorio_url, [UriKind]::Absolute, [ref]$uri) -or
          $uri.Scheme -notin @('http', 'https')) {
        throw 'URL do supervisório inválida.'
      }

      $respondendo = Test-SupervisorioPort -HostName $uri.DnsSafeHost -Port $uri.Port
      $status = if ($respondendo) { 'respondendo' } else { 'sem_resposta' }
      $body = @{
        supervisorio_status       = $status
        supervisorio_verificado_em = [DateTime]::UtcNow.ToString('o')
      } | ConvertTo-Json -Compress
      $id = [Uri]::EscapeDataString([string]$obra.id)
      $updateUrl = "$script:SupabaseUrl/rest/v1/obras_mapa?id=eq.$id"

      Invoke-RestMethod `
        -Method Patch `
        -Uri $updateUrl `
        -Headers ($headers + @{ Prefer = 'return=minimal' }) `
        -ContentType 'application/json' `
        -Body $body `
        -ErrorAction Stop | Out-Null

      Write-MonitorLog ("{0}: {1} ({2}:{3})" -f $obra.nome, $status, $uri.DnsSafeHost, $uri.Port)
    } catch {
      Write-MonitorLog ("Falha ao verificar '{0}': {1}" -f $obra.nome, $_.Exception.Message)
    }
  }
}

do {
  try {
    Invoke-MonitorCycle
  } catch {
    Write-MonitorLog ("Falha no ciclo de monitoramento: {0}" -f $_.Exception.Message)
    if ($Once) {
      throw
    }
  }

  if (-not $Once) {
    Start-Sleep -Seconds $IntervalSeconds
  }
} while (-not $Once)
