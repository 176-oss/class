# lib/

외부 CDN 대신 저장소에 포함한 라이브러리입니다. (2026-11-07 내려받음)
하위 폴더 페이지(seating/, textgenerator/ 등)에서는 `../lib/...`로 불러옵니다.

| 파일 | 라이브러리 | 버전 | 원래 주소 | 사용처 |
|---|---|---|---|---|
| `xlsx.full.min.js` | SheetJS (xlsx) | 0.18.5 | cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/ | textgenerator, textgenerator-v2 |
| `tailwindcss.js` | Tailwind CSS Play CDN | 3.4.17 | cdn.tailwindcss.com (버전 미지정 → 3.4.17) | seating, textgenerator |
| `lucide.min.js` | Lucide | 1.70.0 | unpkg.com/lucide@latest (→ 1.70.0) | index.html, edutime |
| `react.production.min.js` | React | 18.3.1 | unpkg.com/react@18 (→ 18.3.1) | seating |
| `react-dom.production.min.js` | ReactDOM | 18.3.1 | unpkg.com/react-dom@18 (→ 18.3.1) | seating |
| `babel.min.js` | @babel/standalone | 8.1.1 | unpkg.com/@babel/standalone (버전 미지정 → 8.1.1) | seating |
| `html2canvas.min.js` | html2canvas | 1.4.1 | cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/ | seating |
| `jspdf.umd.min.js` | jsPDF | 2.5.1 | cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/ | seating |
| `font-awesome/` | Font Awesome Free | 6.4.0 | cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/ (css + webfonts) | seating |

업데이트할 때는 위 주소에서 새 버전을 내려받아 같은 파일명으로 덮어쓰고 이 표의 버전을 고쳐 주세요.
