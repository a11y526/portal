// 712 「다누리 탐사대장」 달 자원 RPG — 문구·수치 데이터
// 선생님이 문구나 스탯 변화량을 고치기 쉽게 따로 모은 파일입니다.

export const INITIAL_STATS = {
  res: 30,    // 자원 (0~100)
  trust: 50,  // 국제 신뢰 (0~100)
  peace: 50,  // 평화 (0~100)
};

export const STAT_META = [
  { key: 'res',   label: '자원',      desc: '우리 기지가 확보한 달 자원' },
  { key: 'trust', label: '국제 신뢰', desc: '다른 나라·기업이 우리를 믿는 정도' },
  { key: 'peace', label: '평화',      desc: '달 전체가 평화로운 정도' },
];

// 주인공 캐릭터 2종 (LPC 스프라이트 시트)
export const HEROES = [
  {
    id: 'boy',
    name: '남학생 대장',
    sprite: 'assets/img/rpg/boy_walk.png',
  },
  {
    id: 'girl',
    name: '여학생 대장',
    sprite: 'assets/img/rpg/girl_walk.png',
  },
];

// NPC 4종 (LPC 스프라이트 시트)
export const NPCS = {
  arte: {
    id: 'arte',
    name: '아르테 연합 대원',
    role: '선발 탐사국',
    sprite: 'assets/img/rpg/npc_arte_walk.png',
  },
  corp: {
    id: 'corp',
    name: '루나텍 기업 대표',
    role: '민간 우주 기업',
    sprite: 'assets/img/rpg/npc_corp_walk.png',
  },
  south: {
    id: 'south',
    name: '남방 신생국 대원',
    role: '후발 탐사국',
    sprite: 'assets/img/rpg/npc_south_walk.png',
  },
  chair: {
    id: 'chair',
    name: '국제 달 협의회 의장',
    role: '국제 달 협의회',
    sprite: 'assets/img/rpg/npc_chair_walk.png',
  },
};

// 달 표면 지점 (캔버스 기준 좌표: 800×480 가상 해상도)
export const SPOTS = [
  {
    id: 'base',
    name: '우리 탐사대 기지',
    sub: '다누리 자원 지도로 세운 기지',
    x: 165,
    y: 355,
    eventId: 1,
    kind: 'dome',
    color: '#3B82F6',
  },
  {
    id: 'he3',
    name: '헬륨-3 평원',
    sub: '핵융합 에너지 자원 지대',
    x: 195,
    y: 165,
    eventId: 2,
    npc: 'arte',
    npcOffset: { dx: 42, dy: 14 },
    kind: 'plain',
    color: '#F59E0B',
  },
  {
    id: 'rare',
    name: '희토류 크레이터',
    sub: '희토류·백금·티타늄 광산',
    x: 625,
    y: 165,
    eventId: 3,
    npc: 'corp',
    npcOffset: { dx: -44, dy: 14 },
    kind: 'crater',
    color: '#A855F7',
  },
  {
    id: 'ice',
    name: '남극 얼음 지대',
    sub: '물·산소·연료 공급원',
    x: 635,
    y: 350,
    eventId: 4,
    kind: 'ice',
    color: '#38BDF8',
  },
  {
    id: 'debris',
    name: '폐기물 낙하 구역',
    sub: '버려진 착륙선과 부품 더미',
    x: 390,
    y: 145,
    eventId: 5,
    kind: 'debris',
    color: '#94A3B8',
  },
  {
    id: 'south',
    name: '남방 신생국 탐사대',
    sub: '늦게 도착한 소규모 탐사팀',
    x: 430,
    y: 385,
    eventId: 6,
    npc: 'south',
    npcOffset: { dx: 0, dy: 6 },
    kind: 'rover',
    color: '#22C55E',
  },
  {
    id: 'hq',
    name: '국제 달 협의회 본부',
    sub: '3곳 이상 탐사 후 회의 개방',
    x: 400,
    y: 255,
    eventId: 7,
    npc: 'chair',
    npcOffset: { dx: 0, dy: 18 },
    kind: 'hq',
    color: '#2457E6',
    needCount: 3,
  },
];

// 이벤트 7개
// conflict: 학습지 질문 1("달 자원 개발로 생길 수 있는 문제점이나 갈등은?")의 재료
// solution: 학습지 질문 2("달 자원을 평화적으로 분배하는 방안은?")의 재료
export const EVENTS = [
  {
    id: 1,
    spotId: 'base',
    title: '[우리 탐사대 기지] 첫 보고',
    speaker: '탐사대 기지 통신실',
    npc: null,
    conflict: '개발 목적을 둘러싼 갈등 (자원 확보 vs 과학 연구)',
    body: [
      '달 궤도를 도는 다누리 궤도선이 촬영한 달 자원 지도가 기지에 도착했습니다.',
      '지구 본부에서 "다른 나라보다 먼저 달 자원 탐사를 서둘러라"라는 긴급 지시가 내려왔습니다.',
      '하지만 기지 과학 대원들은 "달의 생성 비밀을 밝히는 과학 연구와 공동 관측도 중요하다"고 말합니다.',
    ],
    choices: [
      {
        pick: 1,
        text: '자원 탐사에 모든 장비를 투입한다',
        delta: { res: 15, trust: 0, peace: -5 },
        result: '자원 확보 속도는 빨라졌지만, 경쟁적으로 채굴이 시작되며 긴장이 높아졌습니다.',
        solution: null,
      },
      {
        pick: 2,
        text: '과학 연구와 자원 탐사를 반반씩 함께 진행한다',
        delta: { res: 5, trust: 5, peace: 0 },
        result: '자원을 조사하면서 기초 과학 연구도 균형 있게 이어 나갑니다.',
        solution: null,
      },
      {
        pick: 3,
        text: '탐사·연구 결과를 다른 나라와 투명하게 공유하겠다고 발표한다',
        delta: { res: -5, trust: 15, peace: 0 },
        result: '당장 얻는 자원은 줄었지만, 여러 나라가 우리 탐사대를 신뢰하기 시작했습니다.',
        solution: '탐사·연구 자료를 여러 나라와 공유하기',
      },
    ],
  },
  {
    id: 2,
    spotId: 'he3',
    title: '[헬륨-3 평원] 먼저 꽂힌 깃발',
    speaker: '아르테 연합 대원',
    npc: 'arte',
    conflict: '영토 주장과 독점 갈등',
    body: [
      '청정 에너지원인 헬륨-3가 풍부한 평원에 도착했습니다.',
      '먼저 와 있던 아르테 연합 대원이 가로막으며 말합니다. "여긴 우리가 먼저 깃발을 꽂았으니 우리 땅입니다!"',
    ],
    choices: [
      {
        pick: 1,
        text: '깃발을 뽑아 버리고 우리 채굴 장비를 바로 설치한다',
        delta: { res: 20, trust: -20, peace: -15 },
        result: '헬륨-3는 많이 얻었지만, 아르테 연합과 큰 몸싸움 직전까지 갈등이 번졌습니다.',
        solution: null,
      },
      {
        pick: 2,
        text: '우주 조약을 들어 "달은 누구의 영토도 아니다"라고 설명하고 함께 쓰자고 제안한다',
        delta: { res: 5, trust: 10, peace: 10 },
        result: '아르테 대원도 우주 조약 원칙에 동의하며 평원을 공동 탐사 구역으로 열었습니다.',
        solution: '우주 조약(달 영토 주장 금지) 지키기',
      },
      {
        pick: 3,
        text: '다툼을 피해 자원이 적은 외곽 지역으로 물러난다',
        delta: { res: -5, trust: 0, peace: 5 },
        result: '충돌은 피했지만, 먼저 온 나라가 좋은 구역을 독차지하는 관행이 남았습니다.',
        solution: null,
      },
    ],
  },
  {
    id: 3,
    spotId: 'rare',
    title: '[희토류 크레이터] 기업의 독점',
    speaker: '루나텍 기업 대표',
    npc: 'corp',
    conflict: '거대 기업의 자원 독점과 자원 고갈',
    body: [
      '스마트폰과 우주선 부품에 꼭 필요한 희토류 크레이터를 민간 기업 루나텍이 거대 채굴기로 둘러쌌습니다.',
      '루나텍 대표가 말합니다. "가장 많은 돈을 내는 나라에만 희토류를 독점으로 팔겠습니다."',
      '탐사대 과학자가 귓속말을 합니다. "지금처럼 마구 캐면 이 크레이터의 희토류는 몇 년 안에 바닥날 거예요."',
    ],
    choices: [
      {
        pick: 1,
        text: '큰돈을 내고 우리 기지만 받는 독점 계약을 맺는다',
        delta: { res: 20, trust: -10, peace: -10 },
        result: '희토류는 넉넉히 확보했지만, 다른 나라들이 불공정한 독점이라며 강하게 항의합니다.',
        solution: null,
      },
      {
        pick: 2,
        text: '한 나라가 독점하지 못하도록 공개 공동 경매를 제안한다',
        delta: { res: 5, trust: 10, peace: 0 },
        result: '여러 나라가 정해진 규칙에 따라 희토류를 나누어 살 수 있게 되었습니다.',
        solution: '독점을 막는 공개 규칙 정하기',
      },
      {
        pick: 3,
        text: '기술이나 자금이 부족한 나라에도 일정량을 나누도록 국제 기준을 요구한다',
        delta: { res: -5, trust: 5, peace: 15 },
        result: '우리 몫은 조금 줄었지만, 가난한 나라들도 우주 자원의 혜택을 함께 누리게 되었습니다.',
        solution: '독점을 제한하고 기술이 부족한 나라와도 자원 나누기',
      },
    ],
  },
  {
    id: 4,
    spotId: 'ice',
    title: '[남극 얼음 지대] 물을 둘러싼 다툼',
    speaker: '남극 얼음 채굴장',
    npc: null,
    conflict: '생존 필수 자원(얼음·물)을 둘러싼 다툼',
    body: [
      '달 남극의 얼음(물)은 기지에서 마실 물과 숨 쉴 산소, 로켓 연료를 만드는 가장 소중한 자원입니다.',
      '좁은 얼음층 하나를 두고 세 나라 탐사대가 서로 먼저 쓰겠다며 장비를 맞대고 대치하고 있습니다.',
    ],
    choices: [
      {
        pick: 1,
        text: '우리 탐사차로 앞을 막고 먼저 얼음을 캐낸다',
        delta: { res: 15, trust: 0, peace: -15 },
        result: '얼음은 차지했지만, 다른 기지들이 물 부족에 시달리며 적대감이 커졌습니다.',
        solution: null,
      },
      {
        pick: 2,
        text: '구역과 시간을 나누어 순서대로 채굴하자고 중재한다',
        delta: { res: 0, trust: 5, peace: 10 },
        result: '세 나라가 정해진 시간표에 따라 부딪치지 않고 얼음을 채취했습니다.',
        solution: '개발 구역과 기간·순서를 정해 나누어 쓰기',
      },
      {
        pick: 3,
        text: '세 나라가 비용을 모아 공동 정수·보급 시설을 함께 짓자고 제안한다',
        delta: { res: -5, trust: 10, peace: 10 },
        result: '설치 비용은 들었지만, 모든 기지가 깨끗한 물과 산소를 안정적으로 나누어 쓰게 되었습니다.',
        solution: '공동 시설을 지어 비용과 자원을 함께 나누기',
      },
    ],
  },
  {
    id: 5,
    spotId: 'debris',
    title: '[폐기물 낙하 구역] 우주 쓰레기와 달 환경 훼손',
    speaker: '탐사대 정비반',
    npc: null,
    conflict: '무분별한 개발로 인한 달 환경 훼손과 우주 쓰레기',
    body: [
      '여러 나라가 앞다투어 채굴을 벌이면서 버려진 착륙선 잔해와 고장 난 장비 부품이 달 표면에 쌓였습니다.',
      '날카로운 금속 파편에 우리 탐사차 바퀴가 걸려 멈추고 말았습니다.',
    ],
    choices: [
      {
        pick: 1,
        text: '쓰레기는 그대로 두고 새 채굴 구역으로 돌아서 간다',
        delta: { res: 5, trust: 0, peace: -10 },
        result: '시간은 아꼈지만 달 표면이 쓰레기로 더욱 훼손되어 다른 탐사차들도 잇달아 사고를 겪었습니다.',
        solution: null,
      },
      {
        pick: 2,
        text: '우리 탐사대가 버린 장비와 길목의 파편만 치운다',
        delta: { res: -5, trust: 0, peace: 5 },
        result: '당장 지나갈 길은 열렸지만, 다른 구역에는 여전히 폐기물이 쌓이고 있습니다.',
        solution: '우리가 만든 쓰레기 책임지기',
      },
      {
        pick: 3,
        text: '모든 탐사국이 지켜야 할 달 환경 보호·쓰레기 처리 규칙을 함께 만들자고 제안한다',
        delta: { res: -10, trust: 10, peace: 10 },
        result: '청소 비용과 시간이 들었지만, 달 환경을 지키는 공동 수거 기준이 마련되었습니다.',
        solution: '달 환경 훼손을 막는 보호 규칙 만들기',
      },
    ],
  },
  {
    id: 6,
    spotId: 'south',
    title: '[남방 신생국 대원] 소외된 나라의 호소',
    speaker: '남방 신생국 대원',
    npc: 'south',
    conflict: '우주 기술이 앞선 나라와 늦은 나라 사이의 격차',
    body: [
      '작은 탐사차 한 대로 어렵게 달에 도착한 남방 신생국 대원이 걱정스러운 얼굴로 다가왔습니다.',
      '"우리는 로켓 기술이 부족해 달에 늦게 왔어요. 이미 좋은 자원 지대는 강대국들이 다 차지해서 남은 곳이 없어요."',
    ],
    choices: [
      {
        pick: 1,
        text: '"우주 개발은 먼저 온 사람이 임자입니다"라며 거절한다',
        delta: { res: 5, trust: -15, peace: -10 },
        result: '자원은 아꼈지만, 우주 기술이 늦은 나라들의 거센 반발과 불신이 커졌습니다.',
        solution: null,
      },
      {
        pick: 2,
        text: '우리 기지가 확보한 자원 일부를 나누어 준다',
        delta: { res: -10, trust: 15, peace: 10 },
        result: '남방 신생국 탐사대가 기지를 무사히 세우고 우리의 든든한 협력국이 되었습니다.',
        solution: '후발 국가와 자원을 평화적으로 나누기',
      },
      {
        pick: 3,
        text: '함께 탐사할 수 있도록 채굴 기술 교육과 공동 탐사 참여를 약속한다',
        delta: { res: 0, trust: 10, peace: 5 },
        result: '신생국 대원들도 스스로 달 탐사에 참여할 수 있는 기회를 얻었습니다.',
        solution: '기술이 부족한 나라에 기술을 나누고 공동 탐사하기',
      },
    ],
  },
  {
    id: 7,
    spotId: 'hq',
    title: '[국제 달 협의회 본부] 마지막 회의',
    speaker: '국제 달 협의회 의장',
    npc: 'chair',
    conflict: '달 자원 분배 규칙 부재로 인한 국제 분쟁',
    body: [
      '모든 탐사국 대표들이 국제 달 협의회 본부에 모였습니다.',
      '의장이 다누리 탐사대장에게 묻습니다. "앞으로 달의 자원을 어떻게 개발하고 나눌지 최종 규칙을 정합시다."',
    ],
    choices: [
      {
        pick: 1,
        text: '돈과 기술이 많은 나라가 투자한 만큼 자원을 많이 갖는 규칙을 주장한다',
        delta: { res: 15, trust: 0, peace: -20 },
        result: '강대국들은 찬성했지만, 대다수 나라가 반발하며 협의회가 깨질 위기에 처했습니다.',
        solution: null,
      },
      {
        pick: 2,
        text: '달 이용에 관한 국제법(협정)을 만들고 국제기구가 개발 기간·비용·분배를 공정하게 관리하자고 제안한다',
        delta: { res: 10, trust: 10, peace: 15 },
        result: '국제 달 자원 협정이 통과되어 공동 관리가 시작되었습니다. 정해진 규칙에 따라 우리 기지도 공정한 몫의 자원을 배분받았습니다.',
        // 회의 전 국제 신뢰가 lowTrust 미만이면 아래 결과로 바꿔 보여 준다 (앞의 선택이 이어지도록)
        lowTrust: 40,
        resultLowTrust: '협정은 통과되었지만, 앞서 우리 탐사대의 행동을 기억하는 여러 나라가 반대표를 던졌습니다. 규칙에 따라 우리 기지도 공정한 몫의 자원을 배분받았습니다.',
        solution: '달 이용에 관한 국제법(협정)과 국제기구를 만들어 개발 기간·비용 등을 관리하기',
      },
      {
        pick: 3,
        text: '복잡한 규칙 없이 각 나라가 알아서 자유롭게 개발하자고 한다',
        delta: { res: 5, trust: -5, peace: -10 },
        result: '규칙이 사라지자 곳곳에서 무분별한 채굴과 자리다툼이 다시 벌어졌습니다.',
        solution: null,
      },
    ],
  },
];

// 마지막 회의(7번)에서 의장이 앞의 선택을 다시 꺼내는 한 줄 (이벤트 번호 → 고른 번호 → 문장)
// 탐사한 순서대로 최대 2줄까지 보여 준다. 없는 조합은 건너뛴다.
export const MEETING_RECALL = {
  2: {
    1: '의장: "아르테 연합은 헬륨-3 평원에서 깃발이 뽑힌 일을 아직 기억하고 있습니다."',
    2: '의장: "헬륨-3 평원을 함께 쓰자고 한 제안 덕분에 아르테 연합도 회의에 기꺼이 나왔습니다."',
  },
  3: {
    1: '의장: "루나텍과 맺은 독점 계약 때문에 희토류를 사지 못한 나라들이 불만을 말하고 있습니다."',
    3: '의장: "기술이 부족한 나라에도 희토류를 나누자던 제안을 여러 나라가 기억합니다."',
  },
  4: {
    1: '의장: "남극 얼음을 먼저 차지한 일로 물이 부족했던 기지들이 아직 화가 나 있습니다."',
    3: '의장: "남극의 공동 정수 시설은 지금 모든 기지가 잘 쓰고 있습니다."',
  },
  6: {
    1: '남방 신생국 대원이 굳은 얼굴로 회의장 구석에 앉아 있습니다.',
    2: '남방 신생국 대원이 "자원을 나눠 준 탐사대"라며 우리 쪽을 보고 고개를 끄덕입니다.',
    3: '남방 신생국 대원이 "함께 탐사하자던 약속"을 떠올리며 우리 쪽을 보고 웃습니다.',
  },
};

// 엔딩 4종 (위에서부터 조건이 먼저 맞는 엔딩으로 결정)
// match(s, picks): s = 최종 스탯, picks = { 이벤트번호: 고른 번호 }
// 서버(moon_rpg_finish)의 엔딩 확인 조건도 같게 맞춰 두었다. 조건을 고치면 SQL도 함께 고친다.
// 배지는 정답이 하나인 것처럼 보이지 않도록 같은 무게의 이름을 쓴다.
export const ENDINGS = [
  {
    id: 'peace',
    name: '평화의 달',
    badge: '협력 엔딩',
    summary: '여러 나라가 함께 쓰는 평화로운 달 기지가 세워졌다.',
    detail: '국제법(협정)과 국제기구를 중심으로 자원을 공정하게 나누고 달 환경을 보호하며, 인류 모두의 우주 시대가 열렸습니다.',
    // 마지막 회의에서 국제법·국제기구(②)를 고른 경우에만
    match: (s, picks = {}) => s.peace >= 70 && s.trust >= 60 && picks[7] === 2,
  },
  {
    id: 'balance',
    name: '균형의 달',
    badge: '공존 엔딩',
    summary: '다툼도 있었지만 서로 조심하며 함께 살아간다.',
    detail: '이익을 둘러싼 갈등이 있었으나, 대화와 약속으로 최소한의 질서를 세워 달 탐사를 이어 나가고 있습니다.',
    // 마지막 회의 선택에 따라 설명을 바꾼다 (없으면 detail)
    detailBy7: {
      1: '힘센 나라에 유리한 규칙에 불만이 남았지만, 그동안 쌓은 신뢰 덕분에 큰 다툼 없이 달 탐사를 이어 나가고 있습니다.',
      2: '국제 협정이 만들어졌지만 아직 모든 나라가 서로를 믿지는 못합니다. 약속을 지켜 가며 신뢰를 쌓는 중입니다.',
      3: '정식 규칙은 없지만, 그동안 쌓은 신뢰 덕분에 나라들이 서로 조심하며 달 탐사를 이어 나가고 있습니다.',
    },
    match: (s) => s.peace >= 50,
  },
  {
    id: 'monopoly',
    name: '독점의 달',
    badge: '독점 엔딩',
    summary: '우리 기지는 부자가 되었지만 다른 나라들의 원망을 샀다.',
    detail: '막대한 달 자원을 독차지했지만, 무분별한 개발로 달 환경이 훼손되고 국제 사회에서 고립되었습니다.',
    match: (s) => s.res >= 70 && s.peace < 50,
  },
  {
    id: 'conflict',
    name: '분쟁의 달',
    badge: '분쟁 엔딩',
    summary: '달에서 나라 사이의 다툼이 끊이지 않는다.',
    detail: '자원을 둘러싼 끝없는 분쟁과 우주 쓰레기로 인해 어느 나라도 안전하게 달을 탐사하기 어렵게 되었습니다.',
    match: () => true,
  },
];

// 평화적 해결책을 하나도 고르지 않았을 때 보여 줄 기본 안내 목록 (학습지 질문 2 도움용)
export const FALLBACK_SOLUTIONS = [
  '달 이용에 관한 국제법(협정)과 국제기구를 만들어 개발 기간과 비용 등을 정해서 관리한다.',
  '우주 조약의 원칙(어느 나라도 영토를 주장할 수 없음)을 지키고 공동 시설을 운영한다.',
  '무분별한 개발과 환경 훼손을 막는 보호 규칙을 만들고, 기술이 부족한 나라와도 자원·기술을 나눈다.',
];

// LPC 출처 문구 (6절 필수 라이선스 표기 + 사용한 6개 캐릭터 전체 작가 목록)
export const LPC_CREDITS = `캐릭터 그림: Universal LPC Spritesheet Character Generator
https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/
작가: bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert, Eliza Wyatt (ElizaWy), TheraHedwig, MuffinElZangano, Durrani, Johannes Sjölund (wulax), Stephen Challener (Redshrike), Pierre Vigier (pvigier), Matthew Krohn (makrohn), Sander Frenken (castelonia), dalonedrau, Nila122, kheftel, Manuel Riecke (MrBeast), Thane Brimhall (pennomi), laetissima, Joe White
라이선스: CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0`;
