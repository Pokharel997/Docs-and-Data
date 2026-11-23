# Renders app-icon.svg to app-icon.png (1024×1024, transparent) with headless Chrome.
#   python3 design/render-icon.py        (set CHROME=/path/to/chrome if it isn't in the usual place)
import os, subprocess, tempfile
here = os.path.dirname(os.path.abspath(__file__))
chrome = os.environ.get('CHROME') or next((p for p in [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'] if os.path.exists(p)), 'chrome')
with tempfile.TemporaryDirectory() as profile:
    page = os.path.join(profile, 'icon.html')
    with open(page, 'w') as f:
        f.write(f'<html><body style="margin:0;background:transparent"><img src="file://{os.path.join(here, "app-icon.svg")}" width="1024" height="1024"></body></html>')
    subprocess.run([chrome, '--headless=new', f'--user-data-dir={profile}', '--hide-scrollbars', '--allow-file-access-from-files',
                    '--default-background-color=00000000', '--window-size=1024,1024',
                    f'--screenshot={os.path.join(here, "app-icon.png")}', 'file://' + page],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('app-icon.png')
