// ─────────────────────────────────────────────────────────────
// 설정 파일
//
// firebase 값을 비워 두면(null) "로컬 모드"로 동작합니다.
//   - 이 브라우저에만 저장되므로 혼자 미리 써 보는 용도입니다.
//
// 친구와 함께 쓰려면 README.md 의 안내대로 Firebase 프로젝트를 만들고
// 콘솔에서 복사한 웹 앱 설정값을 아래에 붙여 넣으세요.
// (Firebase 웹 설정값은 공개되어도 되는 값입니다. 접근 제어는 보안 규칙으로 합니다.)
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  siteTitle: '같이 본 영화',

  // Firebase 사용 시 데이터를 나누는 "방 코드"입니다.
  // 비워 두면('') 처음 접속할 때 각자 입력합니다. 친구들끼리 같은 코드를 쓰면 같은 목록을 봅니다.
  // 저장소가 공개(public)라면 여기에 적지 말고 비워 두는 편이 좋습니다(코드가 그대로 노출됨).
  roomCode: '',

  firebase: {
  apiKey: "AIzaSyBCLrmGf_v2bKTXx2_ZQqbX89dNMW8-E5o",
  authDomain: "movie-log-b6315.firebaseapp.com",
  projectId: "movie-log-b6315",
  storageBucket: "movie-log-b6315.firebasestorage.app",
  messagingSenderId: "943811217061",
  appId: "1:943811217061:web:6e76f9274c424f76e46f4c"
}

  // 예시)
  // firebase: {
  //   apiKey: "AIza...",
  //   authDomain: "my-movie-log.firebaseapp.com",
  //   projectId: "my-movie-log",
  //   storageBucket: "my-movie-log.appspot.com",
  //   messagingSenderId: "1234567890",
  //   appId: "1:1234567890:web:abcdef"
  // }
};
