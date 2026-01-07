@echo off
title My Private Office
cd /d "C:\Users\Hamza\Downloads\sickw-orders-mvp (1)\dist"
echo Starting your private office...
:: This starts the server and automatically opens your browser
start "" http://localhost:3000
npx serve -s dist -l 3000