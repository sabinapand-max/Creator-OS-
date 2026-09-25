@echo off
REM Batch to update creator‑os and send report
setlocal enabledelayedexpansionncd "C:\Users\danap\ND-cognitive-OS\creator-os-pilot"
call git pull
set updated=%%date%% %%time%%
rem run tests (if any) – dummy placeholdernecho Tests run
> C:\Users\danap\ND-cognitive-OS\creator-os-pilot\update_report.txt echo !updated! >> C:\Users\danap\ND-cognitive-OS\creator-os-pilot\update_report.txtnREM send email using PowerShell (free email providers or SMTP, placeholder)
echo Donenendlocal