# 같이 본 영화

친구들과 함께 본 영화·드라마에 별점을 매기고, 줄거리·감상·사진을 남기는 사이트입니다.
빌드 과정 없이 GitHub Pages에 그대로 올려 쓸 수 있습니다.

## 기능

- 같이 볼 콘텐츠: 보고 싶은 영화·드라마를 포스터 이미지와 함께 추가
- 콘텐츠 추가 시 "본 콘텐츠"(함께 본 콘텐츠로) / "보고 싶은 콘텐츠"(같이 볼 콘텐츠로) 선택, 추가 창에서는 정보만 입력
- 배경 색상: 기본은 사쿠라 핑크, 상단 "색상"에서 각자 원하는 색으로 변경(내 브라우저에만 적용)
- 별점: 카드 오른쪽 아래 "평가하기" 버튼 → 별을 누르거나 끌어서 5점 만점, 0.5점 단위로 지정 후 저장
- 누군가 첫 별점을 남기면 "같이 볼 콘텐츠"에서 빠지고 위쪽 "함께 본 콘텐츠"로 이동
- 함께 본 콘텐츠 정렬: 최신순(첫 평가일) / 별점순(평균 별점)
- 포스터나 제목을 누르면 상세 화면: 참여자별 별점, 줄거리·소개, 글·사진 기록(1회 최대 3장)
- 한 번 함께 본 콘텐츠가 되면 별점을 지워도 그대로 유지
- 폰트: 제목·버튼은 주아체, 본문은 고운돋움 (Google Fonts)

## 파일 구성

| 파일 | 내용 |
|---|---|
| index.html | 화면 뼈대 |
| style.css | 디자인 |
| app.js | 화면 동작(목록, 상세, 별점, 글쓰기) |
| store.js | 데이터 저장(Firebase 또는 브라우저 저장) |
| config.js | 사이트 이름, 방 코드, Firebase 설정 |

## 1단계: 혼자 미리 보기

`config.js`의 `firebase`가 `null`이면 미리보기 모드로 동작하며, 데이터는 지금 쓰는 브라우저에만 저장됩니다.

ES 모듈을 쓰기 때문에 `index.html`을 더블클릭으로 열면 동작하지 않습니다. 폴더에서 간단한 웹 서버를 띄워 확인하세요.

```bash
python -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

## 2단계: 친구와 함께 쓰기 (Firebase 연결, 무료 요금제로 충분)

GitHub Pages는 파일만 보여 주는 서비스라 여러 사람의 별점·글을 저장할 곳이 따로 필요합니다. 여기서는 Google Firebase의 Firestore를 사용합니다.

1. https://console.firebase.google.com 에서 프로젝트 만들기 (Google 애널리틱스는 꺼도 됨)
2. 빌드 > Authentication > 시작하기 > 로그인 방법에서 "익명" 사용 설정
3. 빌드 > Firestore Database > 데이터베이스 만들기 (위치는 asia-northeast3 서울 권장, 프로덕션 모드로 시작)
4. Firestore > 규칙 탭에 아래 내용을 붙여 넣고 게시

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /rooms/{room}/items/{item} {
         allow read, write: if request.auth != null;
         match /posts/{post} {
           allow read, write: if request.auth != null;
         }
       }
     }
   }
   ```

5. 프로젝트 설정(톱니바퀴) > 내 앱 > 웹 앱 추가(</> 아이콘) > 앱 등록 후 나오는 `firebaseConfig` 값을 `config.js`의 `firebase:` 자리에 붙여 넣기
6. Authentication > 설정 > 승인된 도메인에 `내아이디.github.io` 추가

사진은 Firebase Storage를 쓰지 않고, 브라우저에서 크기를 줄인 뒤 Firestore 문서에 함께 저장합니다. 그래서 유료(Blaze) 요금제 없이 무료(Spark) 요금제로 쓸 수 있습니다.

## 3단계: GitHub Pages로 배포

1. GitHub에서 새 저장소를 만들고 이 폴더의 파일을 모두 올리기 (`.nojekyll` 포함)
2. 저장소 Settings > Pages > Build and deployment에서 Source를 "Deploy from a branch", Branch를 `main` / `/ (root)`로 저장
3. 1~2분 뒤 `https://내아이디.github.io/저장소이름/` 으로 접속

## 방 코드와 보안에 대해

- `config.js`의 `roomCode`를 비워 두면 처음 접속할 때 각자 방 코드를 입력합니다. 같은 코드를 입력한 사람끼리 같은 목록을 봅니다. 사실상 친구들끼리의 공용 비밀번호 역할입니다.
- 공개 저장소라면 `roomCode`를 config.js에 적지 마세요. 파일 내용이 누구에게나 보입니다.
- Firebase 웹 설정값(apiKey 등)은 원래 공개되는 값이라 노출되어도 괜찮습니다. 다만 이 구성은 로그인 없이 쓰는 간단한 방식이라, 방 코드를 아는 사람은 누구나 글을 쓰고 지울 수 있습니다. 친구끼리 쓰는 용도로 생각해 주세요.
- 이름은 각 브라우저에 저장됩니다. 다른 기기에서도 같은 이름을 입력해야 별점이 이어집니다.

## 사용량 참고 (Firebase 무료 요금제)

- 저장 공간 1GB, 하루 읽기 5만 건 / 쓰기 2만 건
- 사진 1장은 약 100~250KB로 줄여 저장하므로, 친구 몇 명이 쓰기에는 충분합니다.
