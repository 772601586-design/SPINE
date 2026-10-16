# Local system voice; creates generic count prompts, never clinical instructions.
$ErrorActionPreference = 'Stop'
$audioRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets/rhythm'))
New-Item -ItemType Directory -Force -Path $audioRoot | Out-Null
$voice = New-Object -ComObject SAPI.SpVoice
$chinese = @($voice.GetVoices() | Where-Object { $_.GetDescription() -match 'Chinese' })
if ($chinese.Count -eq 0) { throw 'Install a Chinese system voice before generating prompts.' }
$voice.Voice = $chinese[0]
$voice.Rate = 1
$prompts = @{ begin='开始'; paused='暂停'; done='本组节奏结束，请确认实际完成量'; '100'='百' }
0..20 | ForEach-Object { $prompts[[string]$_] = [string]$_ }
30,40,50,60,70,80,90 | ForEach-Object { $prompts[[string]$_] = [string]$_ }
foreach ($key in $prompts.Keys) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Format.Type = 6 # 8 kHz, 16 bit mono WAV
    $stream.Open((Join-Path $audioRoot ($key + '.wav')), 3, $false)
    try { $voice.AudioOutputStream = $stream; $voice.Speak($prompts[$key], 0) | Out-Null }
    finally { $stream.Close() }
}
