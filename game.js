const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

canvasElement.width = window.innerWidth;
canvasElement.height = window.innerHeight;

let player = { x: canvasElement.width / 2, y: canvasElement.height - 100, size: 40 };
let handsDistance = 0;
let isTwoHands = false;
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

hands.onResults(onResults);
const camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 640, height: 480
});
camera.start();
let handsCount = 0;
function onResults(results) {
    handsCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
    if (results.multiHandLandmarks && results.multiHandLandmarks.length === 2) {
        isTwoHands = true;

        const hand1 = results.multiHandLandmarks[0][9];
        const hand2 = results.multiHandLandmarks[1][9];
        const x1 = hand1.x * canvasElement.width;
        const y1 = hand1.y * canvasElement.height;
        const x2 = hand2.x * canvasElement.width;
        const y2 = hand2.y * canvasElement.height;

        player.x = (x1 + x2) / 2;
        player.y = (y1 + y2) / 2;
        handsDistance = Math.hypot(x2 - x1, y2 - y1);
    } else {
        isTwoHands = false;
    }
}

let bullets = [];
let enemies = [];
let obstacles = [];
let boss = null;
let lastShotTime = 0;
const shootThreshold = 150;
const gameStartTime = Date.now();
let isGameOver = false;

function gameLoop() {
    if (isGameOver) return;

    canvasCtx.fillStyle = '#111';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    const currentTime = Date.now();
    const elapsedTime = (currentTime - gameStartTime) / 1000;

    // Debug HUD: แสดงจำนวนมือที่ตรวจจับได้และระยะห่างมือ
    canvasCtx.fillStyle = handsCount === 2 ? '#0f0' : '#f55';
    canvasCtx.font = '20px monospace';
    canvasCtx.fillText(`Hands: ${handsCount}/2  Distance: ${Math.round(handsDistance)}`, 20, 30);

    // ระบบยิงปืน (เช็กระยะมือ)
    if (isTwoHands && handsDistance > shootThreshold && currentTime - lastShotTime > 200) {
        bullets.push({ x: player.x, y: player.y - 20, speed: 10 });
        lastShotTime = currentTime;
    }

    // อัปเดตและวาดกระสุนผู้เล่น
    canvasCtx.fillStyle = 'yellow';
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.y -= b.speed;
        canvasCtx.fillRect(b.x - 2, b.y, 4, 15);
        if (b.y < 0) bullets.splice(i, 1);
    }

    // วาดผู้เล่น (ยานอวกาศ)
    canvasCtx.fillStyle = 'cyan';
    canvasCtx.fillRect(player.x - player.size / 2, player.y - player.size / 2, player.size, player.size);

    // ระบบบอส (วินาทีที่ 90)
    if (elapsedTime >= 90 && !boss) {
        boss = { x: canvasElement.width / 2, y: 100, hp: 100, size: 80, bullets: [] };
    }
    if (boss) {
        // วาดบอส
        canvasCtx.fillStyle = 'red';
        canvasCtx.fillRect(boss.x - boss.size / 2, boss.y - boss.size / 2, boss.size, boss.size);

        // บอสยิงกระจาย
        if (Math.random() < 0.05) {
            for (let angle = -2; angle <= 2; angle++) {
                boss.bullets.push({ x: boss.x, y: boss.y + boss.size / 2, vx: angle * 2, vy: 5 });
            }
        }

        // อัปเดตกระสุนบอส
        canvasCtx.fillStyle = 'orange';
        for (let i = boss.bullets.length - 1; i >= 0; i--) {
            let bb = boss.bullets[i];
            bb.x += bb.vx;
            bb.y += bb.vy;
            canvasCtx.beginPath();
            canvasCtx.arc(bb.x, bb.y, 5, 0, Math.PI * 2);
            canvasCtx.fill();

            // เช็กชนผู้เล่น
            if (Math.hypot(bb.x - player.x, bb.y - player.y) < player.size / 2 + 5) {
                isGameOver = true;
                alert("Game Over!");
            }
            if (bb.y > canvasElement.height) boss.bullets.splice(i, 1);
        }

        // เช็กกระสุนผู้เล่นชนบอส
        for (let i = bullets.length - 1; i >= 0; i--) {
            let b = bullets[i];
            if (b.x > boss.x - boss.size / 2 && b.x < boss.x + boss.size / 2 &&
                b.y > boss.y - boss.size / 2 && b.y < boss.y + boss.size / 2) {
                boss.hp -= 1;
                bullets.splice(i, 1);
                if (boss.hp <= 0) {
                    alert("You Win!");
                    isGameOver = true;
                }
            }
        }
    } else {
        // ระบบศัตรูทั่วไป (ถ้าบอสยังไม่เกิด)
        if (Math.random() < 0.02) {
            enemies.push({ x: Math.random() * canvasElement.width, y: -20, speed: 3, size: 30 });
        }
        canvasCtx.fillStyle = 'pink';
        for (let i = enemies.length - 1; i >= 0; i--) {
            let e = enemies[i];
            e.y += e.speed;
            canvasCtx.fillRect(e.x - e.size / 2, e.y - e.size / 2, e.size, e.size);
            // ชนผู้เล่น
            if (Math.hypot(e.x - player.x, e.y - player.y) < player.size / 2 + e.size / 2) {
                isGameOver = true;
                alert("Game Over!");
            }
            // โดนยิง
            for (let j = bullets.length - 1; j >= 0; j--) {
                let b = bullets[j];
                if (b.x > e.x - e.size / 2 && b.x < e.x + e.size / 2 &&
                    b.y > e.y - e.size / 2 && b.y < e.y + e.size / 2) {
                    enemies.splice(i, 1);
                    bullets.splice(j, 1);
                    break;
                }
            }
            if (e && e.y > canvasElement.height) enemies.splice(i, 1);
        }
    }

    requestAnimationFrame(gameLoop);
}
gameLoop();
