$ErrorActionPreference = "Stop"

$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $agentRoot "dist\BroadreachPrintAgent.exe"
$taskName = "Broadreach Print Agent"
if (Test-Path $exePath) {
  $action = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory $agentRoot
} else {
  $action = New-ScheduledTaskAction -Execute "node" -Argument "`"$agentRoot\agent.js`"" -WorkingDirectory $agentRoot
}
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DisallowStartIfOnBatteries:$false -ExecutionTimeLimit (New-TimeSpan -Days 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Broadreach Print Agent installed and started."
Write-Host "Config/token file: $env:APPDATA\BroadreachPrintAgent\agent-config.json"
