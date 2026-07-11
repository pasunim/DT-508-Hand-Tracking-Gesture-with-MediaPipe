// ===== อ้างอิง element หลักของหน้าเว็บ =====
const videoElement = document.getElementById('input_video');   // แท็ก <video> ที่แสดงภาพจากเว็บแคม
const canvasElement = document.getElementById('output_canvas'); // แท็ก <canvas> ที่ใช้วาดตัวเกมทั้งหมด
const canvasCtx = canvasElement.getContext('2d');               // context สำหรับสั่งวาดกราฟิก 2 มิติบน canvas

// ตั้งขนาด canvas ให้เท่ากับขนาดหน้าต่างเบราว์เซอร์
canvasElement.width = window.innerWidth;
canvasElement.height = window.innerHeight;

// ตัวแปรเก็บสถานะของผู้เล่น (ตำแหน่ง x, y และขนาดของยาน)
let player = { x: canvasElement.width / 2, y: canvasElement.height - 100, size: 120 };

// ===== ฟังก์ชันช่วยโหลดรูปภาพ แล้วลบพื้นหลังสีดำออกให้กลายเป็นโปร่งใส =====
// ใช้กับรูป player/enemy/boss ที่พื้นหลังเป็นสีดำล้วน (chroma key แบบ near-black)
function loadImageWithoutBlackBg(src, onReady) {
    const raw = new Image();
    raw.crossOrigin = 'anonymous';
    raw.onload = () => {
        // สร้าง canvas ที่มองไม่เห็น (offscreen) ไว้แก้ไขพิกเซลของรูปต้นฉบับ
        const off = document.createElement('canvas');
        off.width = raw.naturalWidth;
        off.height = raw.naturalHeight;
        const offCtx = off.getContext('2d');
        offCtx.drawImage(raw, 0, 0);

        // ดึงข้อมูลสีของทุกพิกเซลออกมา (data คือ array แบบ [R,G,B,A, R,G,B,A, ...])
        const imageData = offCtx.getImageData(0, 0, off.width, off.height);
        const data = imageData.data;
        const BLACK_THRESHOLD = 30; // ค่าสีต่ำกว่านี้ถือว่า "เกือบดำ" ทั้ง 3 ช่อง (R,G,B)
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] < BLACK_THRESHOLD && data[i + 1] < BLACK_THRESHOLD && data[i + 2] < BLACK_THRESHOLD) {
                data[i + 3] = 0; // ตั้งค่า alpha (ความทึบ) เป็น 0 = โปร่งใส
            }
        }
        offCtx.putImageData(imageData, 0, 0);

        // แปลง canvas ที่แก้ไขแล้วกลับเป็นรูปภาพใหม่ ส่งกลับไปให้ผู้เรียกใช้งาน (callback)
        const cleanImage = new Image();
        cleanImage.src = off.toDataURL();
        onReady(cleanImage);
    };
    raw.src = src;
}

// โหลดรูปยานผู้เล่น / ศัตรู / บอส (พื้นหลังดำจะถูกลบออกโดยอัตโนมัติ)
let playerImage = new Image();
loadImageWithoutBlackBg('images/player.png', (img) => { playerImage = img; });

let enemyImage = new Image();
loadImageWithoutBlackBg('images/enemy.png', (img) => { enemyImage = img; });

let bossImage = new Image();
loadImageWithoutBlackBg('images/boss.png', (img) => { bossImage = img; });

// ===== ตั้งค่า MediaPipe Hands (โมเดลตรวจจับมือ) =====
let handsDistance = 0;   // ระยะห่างระหว่างมือ 2 ข้าง (พิกเซล) ใช้เป็นเงื่อนไขยิงปืน
let isTwoHands = false;  // true เมื่อกล้องตรวจจับมือได้ครบ 2 ข้างในเฟรมนั้น

const hands = new Hands({
    // บอกตำแหน่งที่จะโหลดไฟล์โมเดลของ MediaPipe จาก CDN
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,              // ตรวจจับมือได้สูงสุด 2 ข้าง
    modelComplexity: 1,          // ความซับซ้อนของโมเดล (0 = เบา/เร็ว, 1 = แม่นยำกว่า)
    minDetectionConfidence: 0.5, // ความมั่นใจขั้นต่ำในการ "เจอ" มือ (0-1)
    minTrackingConfidence: 0.5   // ความมั่นใจขั้นต่ำในการ "ติดตาม" มือระหว่างเฟรม (0-1)
});

hands.onResults(onResults); // ทุกครั้งที่ MediaPipe ประมวลผลเฟรมเสร็จ จะเรียกฟังก์ชัน onResults

// ตั้งค่ากล้อง ให้ส่งภาพจาก videoElement เข้า MediaPipe ทุกเฟรม
const camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 640, height: 480
});
camera.start(); // เริ่มเปิดกล้องและวนลูปส่งภาพ

let handsCount = 0; // จำนวนมือที่ตรวจจับได้ในเฟรมล่าสุด (ใช้แสดงบน Debug HUD)

// ฟังก์ชันนี้ถูกเรียกทุกครั้งที่ MediaPipe วิเคราะห์เฟรมภาพเสร็จ
function onResults(results) {
    handsCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

    // ต้องเจอมือครบ 2 ข้างเท่านั้น ถึงจะคำนวณตำแหน่งยานและระยะห่างมือ
    if (results.multiHandLandmarks && results.multiHandLandmarks.length === 2) {
        isTwoHands = true;

        // landmark จุดที่ 9 คือโคนนิ้วกลาง (Middle Finger MCP) ของมือแต่ละข้าง
        const hand1 = results.multiHandLandmarks[0][9];
        const hand2 = results.multiHandLandmarks[1][9];

        // ค่า x, y ที่ได้จาก MediaPipe เป็นสัดส่วน 0-1 ต้องคูณกับขนาด canvas เพื่อแปลงเป็นพิกัดจริง
        const x1 = hand1.x * canvasElement.width;
        const y1 = hand1.y * canvasElement.height;
        const x2 = hand2.x * canvasElement.width;
        const y2 = hand2.y * canvasElement.height;

        // ตำแหน่งยาน = จุดกึ่งกลางระหว่างมือทั้งสองข้าง
        player.x = (x1 + x2) / 2;
        player.y = (y1 + y2) / 2;

        // ระยะห่างระหว่างมือ (ใช้ตัดสินใจว่ากางมือกว้างพอจะยิงหรือยัง)
        handsDistance = Math.hypot(x2 - x1, y2 - y1);
    } else {
        isTwoHands = false; // เห็นมือไม่ครบ 2 ข้าง -> ยานหยุดขยับ/หยุดยิง
    }
}

// ===== ตัวแปรสถานะของเกม =====
let bullets = [];               // กระสุนของผู้เล่น
let enemies = [];                // ศัตรูทั่วไปที่ตกลงมา
let obstacles = [];              // (สำรองไว้ ยังไม่ได้ใช้งาน)
let boss = null;                 // ข้อมูลบอส (null จนกว่าจะถึงเวลาบอสเกิด)
let lastShotTime = 0;            // เวลาล่าสุดที่ยิงกระสุน (ใช้ทำ cooldown)
const shootThreshold = 150;      // ระยะห่างมือขั้นต่ำ (px) ที่ทำให้ยิงกระสุนได้
const gameStartTime = Date.now(); // เวลาที่เกมเริ่ม ใช้คำนวณเวลาที่ผ่านไป
let isGameOver = false;          // true เมื่อเกมจบ (แพ้หรือชนะ) จะหยุด game loop
let score = 0;                   // คะแนนสะสมจากการยิงศัตรูตก

// แสดงป๊อปอัปจบเกมด้วย SweetAlert2 แทน alert() เดิม (สวยกว่าและกันไม่ให้เด้งซ้ำ)
function showGameEndPopup({ icon, title, text }) {
    if (isGameOver) return; // ป้องกัน popup เด้งซ้ำถ้าเงื่อนไขจบเกมเป็นจริงหลายเฟรมติดกัน
    isGameOver = true;
    Swal.fire({
        icon,
        title,
        text,
        confirmButtonText: 'เล่นใหม่',
        allowOutsideClick: false
    }).then(() => {
        location.reload(); // กดปุ่มแล้วรีโหลดหน้าเพื่อเริ่มเกมใหม่
    });
}

// ===== ลูปหลักของเกม ทำงานซ้ำทุกเฟรมด้วย requestAnimationFrame (~60 FPS) =====
function gameLoop() {
    if (isGameOver) return; // เกมจบแล้ว ไม่ต้องวาดหรืออัปเดตอะไรต่อ

    // เคลียร์หน้าจอด้วยสีพื้นหลังเข้ม ก่อนวาดเฟรมใหม่ทับ
    canvasCtx.fillStyle = '#111';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    const currentTime = Date.now();
    const elapsedTime = (currentTime - gameStartTime) / 1000; // เวลาที่ผ่านไปนับจากเริ่มเกม (วินาที)

    // --- Debug HUD: แสดงจำนวนมือที่ตรวจจับได้และระยะห่างมือ ---
    // สีเขียว = เจอมือครบ 2 ข้าง, สีแดง = ยังเจอไม่ครบ
    canvasCtx.fillStyle = handsCount === 2 ? '#0f0' : '#f55';
    canvasCtx.font = '20px monospace';
    canvasCtx.fillText(`Hands: ${handsCount}/2  Distance: ${Math.round(handsDistance)}`, 20, 30);

    // --- แสดงคะแนนปัจจุบัน ---
    canvasCtx.fillStyle = '#fff';
    canvasCtx.fillText(`Score: ${score}`, 20, 60);

    // --- ระบบยิงปืน (เช็กระยะมือ) ---
    // ต้องเจอมือครบ 2 ข้าง + กางมือห่างเกิน shootThreshold + ผ่าน cooldown 200ms แล้ว ถึงจะยิงได้
    if (isTwoHands && handsDistance > shootThreshold && currentTime - lastShotTime > 200) {
        bullets.push({ x: player.x, y: player.y - 20, speed: 10 });
        lastShotTime = currentTime;
    }

    // --- อัปเดตและวาดกระสุนผู้เล่น ---
    // วนลูปจากท้ายมาหน้า เพื่อให้ splice() ระหว่างลูปไม่กระทบ index ที่ยังไม่ได้ตรวจ
    canvasCtx.fillStyle = 'yellow';
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.y -= b.speed;                                   // กระสุนเลื่อนขึ้นทุกเฟรม
        canvasCtx.fillRect(b.x - 2, b.y, 4, 15);          // วาดกระสุนเป็นแท่งเหลือง
        if (b.y < 0) bullets.splice(i, 1);                // หลุดจอบนแล้ว ลบทิ้ง
    }

    // --- วาดผู้เล่น (ยานอวกาศ) ---
    // ถ้ารูปโหลดเสร็จแล้วใช้รูปจริง ถ้ายังไม่เสร็จ fallback เป็นสี่เหลี่ยม cyan ไปก่อน
    if (playerImage.complete && playerImage.naturalWidth > 0) {
        canvasCtx.drawImage(
            playerImage,
            player.x - player.size / 2,
            player.y - player.size / 2,
            player.size,
            player.size
        );
    } else {
        canvasCtx.fillStyle = 'cyan';
        canvasCtx.fillRect(player.x - player.size / 2, player.y - player.size / 2, player.size, player.size);
    }

    // --- ระบบบอส (เกิดที่วินาทีที่ 90) ---
    if (elapsedTime >= 90 && !boss) {
        boss = { x: canvasElement.width / 2, y: 100, hp: 100, size: 200, bullets: [] };
    }

    if (boss) {
        // วาดบอส (ใช้รูปถ้าโหลดเสร็จแล้ว ไม่งั้น fallback เป็นสี่เหลี่ยมแดง)
        if (bossImage.complete && bossImage.naturalWidth > 0) {
            canvasCtx.drawImage(bossImage, boss.x - boss.size / 2, boss.y - boss.size / 2, boss.size, boss.size);
        } else {
            canvasCtx.fillStyle = 'red';
            canvasCtx.fillRect(boss.x - boss.size / 2, boss.y - boss.size / 2, boss.size, boss.size);
        }

        // บอสยิงกระสุนกระจาย 5 ทิศ (มุม -2 ถึง 2) แบบสุ่มโอกาส 5% ต่อเฟรม
        if (Math.random() < 0.05) {
            for (let angle = -2; angle <= 2; angle++) {
                boss.bullets.push({ x: boss.x, y: boss.y + boss.size / 2, vx: angle * 2, vy: 5 });
            }
        }

        // อัปเดตและวาดกระสุนของบอส (เป็นวงกลมสีส้ม)
        canvasCtx.fillStyle = 'orange';
        for (let i = boss.bullets.length - 1; i >= 0; i--) {
            let bb = boss.bullets[i];
            bb.x += bb.vx;
            bb.y += bb.vy;
            canvasCtx.beginPath();
            canvasCtx.arc(bb.x, bb.y, 5, 0, Math.PI * 2);
            canvasCtx.fill();

            // เช็กว่ากระสุนบอสชนผู้เล่นหรือยัง -> ถ้าชน จบเกม (แพ้)
            if (Math.hypot(bb.x - player.x, bb.y - player.y) < player.size / 2 + 5) {
                showGameEndPopup({ icon: 'error', title: 'Game Over!', text: `คะแนนของคุณ: ${score}` });
            }
            if (bb.y > canvasElement.height) boss.bullets.splice(i, 1); // หลุดจอแล้ว ลบทิ้ง
        }

        // เช็กว่ากระสุนผู้เล่นชนบอสหรือไม่ -> ถ้าชน ลด hp บอส และลบกระสุนทิ้ง
        for (let i = bullets.length - 1; i >= 0; i--) {
            let b = bullets[i];
            if (b.x > boss.x - boss.size / 2 && b.x < boss.x + boss.size / 2 &&
                b.y > boss.y - boss.size / 2 && b.y < boss.y + boss.size / 2) {
                boss.hp -= 1;
                bullets.splice(i, 1);
                if (boss.hp <= 0) {
                    // บอส hp หมด = ชนะเกม
                    showGameEndPopup({ icon: 'success', title: 'Mission Completed!', text: `คะแนนของคุณ: ${score}` });
                }
            }
        }
    } else {
        // --- ระบบศัตรูทั่วไป (ทำงานเฉพาะตอนที่บอสยังไม่เกิด) ---

        // สุ่มเกิดศัตรูใหม่จากขอบบนของจอ (โอกาส 2% ต่อเฟรม)
        if (Math.random() < 0.02) {
            enemies.push({ x: Math.random() * canvasElement.width, y: -20, speed: 3, size: player.size });
        }

        canvasCtx.fillStyle = 'pink';
        for (let i = enemies.length - 1; i >= 0; i--) {
            let e = enemies[i];
            e.y += e.speed; // ศัตรูเลื่อนลงทุกเฟรม

            // วาดศัตรู (ใช้รูปถ้าโหลดเสร็จแล้ว ไม่งั้น fallback เป็นสี่เหลี่ยมชมพู)
            if (enemyImage.complete && enemyImage.naturalWidth > 0) {
                canvasCtx.drawImage(enemyImage, e.x - e.size / 2, e.y - e.size / 2, e.size, e.size);
            } else {
                canvasCtx.fillRect(e.x - e.size / 2, e.y - e.size / 2, e.size, e.size);
            }

            // เช็กว่าศัตรูชนผู้เล่นหรือไม่ -> ถ้าชน จบเกม (แพ้)
            if (Math.hypot(e.x - player.x, e.y - player.y) < player.size / 2 + e.size / 2) {
                showGameEndPopup({ icon: 'error', title: 'Game Over!', text: `คะแนนของคุณ: ${score}` });
            }

            // เช็กว่ากระสุนผู้เล่นชนศัตรูตัวนี้หรือไม่ -> ถ้าชน ลบศัตรู+กระสุน แล้วเพิ่มคะแนน
            for (let j = bullets.length - 1; j >= 0; j--) {
                let b = bullets[j];
                if (b.x > e.x - e.size / 2 && b.x < e.x + e.size / 2 &&
                    b.y > e.y - e.size / 2 && b.y < e.y + e.size / 2) {
                    enemies.splice(i, 1);
                    bullets.splice(j, 1);
                    score++;
                    break; // กระสุนนัดนี้โดนแล้ว ไม่ต้องเช็กกระสุนนัดอื่นกับศัตรูตัวนี้ต่อ
                }
            }

            if (e && e.y > canvasElement.height) enemies.splice(i, 1); // หลุดจอล่างแล้ว ลบทิ้ง
        }
    }

    requestAnimationFrame(gameLoop); // สั่งให้เบราว์เซอร์เรียก gameLoop() อีกครั้งในเฟรมถัดไป
}
gameLoop(); // เริ่มลูปเกมครั้งแรก
