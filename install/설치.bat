@echo off
rem science-portal installer: downloads install.ps1 from GitHub and runs it
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $w=New-Object Net.WebClient; $w.Encoding=[Text.Encoding]::UTF8; $t=$w.DownloadString('https://raw.githubusercontent.com/a11y526/science-portal/main/install/install.ps1'); Invoke-Expression $t.TrimStart([char]0xFEFF)"
echo.
pause
