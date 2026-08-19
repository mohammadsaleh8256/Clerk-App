# سیستم فراخوانی افراد (Clerk App)

یک سیستم کامل، production-ready و قابل استفاده واقعی برای فراخوانی افراد در شبکه محلی (LAN).

این سیستم برای محیط‌هایی مانند اداره، درمانگاه، کارگاه، سالن انتظار، بانک و هر محیطی که افراد با شماره فراخوانی می‌شوند طراحی شده است.

---

## فهرست

- [ویژگی‌ها](#ویژگی‌ها)
- [معماری سیستم](#معماری-سیستم)
- [پیش‌نیازها](#پیش‌نیازها)
- [نصب و راه‌اندازی](#نصب-و-راهاندازی)
- [اجرای پروژه](#اجرای-پروژه)
- [پیدا کردن IP لپ‌تاپ](#پیدا-کردن-ip-لپتاپ)
- [اتصال تلویزیون](#اتصال-تلویزیون)
- [تنظیمات فایروال ویندوز](#تنظیمات-فایروال-ویندوز)
- [آپلود فایل صوتی](#آپلود-فایل-صوتی)
- [ساختار پروژه](#ساختار-پروژه)
- [پیکربندی](#پیکربندی)
- [WebSocket Protocol](#websocket-protocol)
- [REST API](#rest-api)
- [مدیریت صف](#مدیریت-صف)
- [Recovery و Restart](#recovery-و-restart)
- [تست‌ها](#تستها)
- [عیب‌یابی](#عیبیابی)
- [امنیت](#امنیت)

---

## ویژگی‌ها

- ✅ **Backend**: Node.js، TypeScript، Fastify، WebSocket (`ws`)، Prisma، SQLite
- ✅ **Frontend**: React، Vite، TypeScript، Tailwind CSS
- ✅ **WebSocket realtime** — بدون polling، بدون SSE، بدون Socket.IO
- ✅ **پشتیبانی از چند تلویزیون** — هر TV یک ID منحصر به فرد دارد
- ✅ **صف فراخوانی (Queue)** با Persistence در SQLite
- ✅ **مدیریت کامل افراد (CRUD)** + آپلود فایل صوتی
- ✅ **پخش خودکار صدا** با فعال‌سازی اولیه (مدیریت autoplay browser)
- ✅ **Reconnect خودکار** با exponential backoff
- ✅ **Synchronization** کامل بین Admin و Display
- ✅ **تاریخچه فراخوانی‌ها** با Search
- ✅ **امنیت Upload**: path traversal، MIME validation، file size limit، extension whitelist
- ✅ **RTL و فارسی** کامل
- ✅ **بدون نیاز به اینترنت** — کاملاً LAN-only، بدون CDN

---

## معماری سیستم

```
Laptop (Server)
├── REST API (Fastify)
├── WebSocket Server (ws)
├── SQLite Database (Prisma)
├── Audio Storage (filesystem)
├── Admin Web App (React)
└── Display Web App (React)

TV (Client)
└── Browser
    └── Display Web App + WebSocket Client
```

### URLs

- **Admin**: `http://<laptop-ip>:3000/admin`
- **Display**: `http://<laptop-ip>:3000/display`
- **WebSocket**: `ws://<laptop-ip>:3000/ws`
- **REST API**: `http://<laptop-ip>:3000/api/*`
- **Audio files**: `http://<laptop-ip>:3000/uploads/audio/<filename>`

سرور روی `0.0.0.0` گوش می‌دهد تا دستگاه‌های داخل LAN بتوانند به آن متصل شوند.

---

## پیش‌نیازها

- **Node.js** نسخه 18 یا بالاتر (توصیه: 20 LTS)
- **npm** نسخه 9 یا بالاتر
- یک لپ‌تاپ یا کامپیوتر به عنوان Server
- یک یا چند تلویزیون هوشمند یا مانیتور با مرورگر وب

برای چک کردن نسخه Node:

```bash
node --version
npm --version
```

---

## نصب و راه‌اندازی

### 1. Clone کردن پروژه

```bash
git clone https://github.com/mohammadsaleh8256/Clerk-App.git
cd Clerk-App
```

### 2. نصب dependencyها

```bash
npm install
```

### 3. راه‌اندازی دیتابیس

```bash
npm run db:setup
```

این دستور Prisma Client را generate می‌کند و جدول‌ها را در SQLite ایجاد می‌کند.

---

## اجرای پروژه

### حالت توسعه (Development)

در دو ترمینال جداگانه:

```bash
# ترمینال 1: سرور
npm run dev:server

# ترمینال 2: کلاینت (Vite dev server)
npm run dev:client
```

یا همزمان با یک دستور:

```bash
npm run dev
```

- سرور روی `http://localhost:3000`
- کلاینت Vite روی `http://localhost:5173` (با proxy به سرور)

### حالت Production

```bash
# Build کلاینت و سرور
npm run build

# اجرای سرور (که کلاینت build شده را هم serve می‌کند)
npm start
```

سپس مرورگر را روی این آدرس‌ها باز کنید:

- Admin: `http://localhost:3000/admin`
- Display: `http://localhost:3000/display`

---

## پیدا کردن IP لپ‌تاپ

برای اتصال تلویزیون‌ها به سرور، باید IP محلی لپ‌تاپ را بدانید.

### ویندوز

```bash
ipconfig
```

به دنبال بخش `Ethernet adapter` یا `Wi-Fi` بگردید و مقدار `IPv4 Address` را یادداشت کنید.
مثلاً: `192.168.1.50`

### macOS

```bash
ifconfig | grep "inet "
```

یا از تنظیمات شبکه: `System Settings > Network > Wi-Fi > Details > IP Address`

### Linux

```bash
hostname -I
```

یا

```bash
ip addr show
```

به دنبال `inet 192.168.x.x` بگردید.

---

## اتصال تلویزیون

1. **سرور را اجرا کنید** روی لپ‌تاپ.
2. **اطمینان حاصل کنید** که تلویزیون و لپ‌تاپ به همان شبکه Wi-Fi/LAN متصل هستند.
3. مرورگر تلویزیون را باز کنید (Chrome، Firefox، یا مرورگر داخلی TV).
4. آدرس زیر را وارد کنید:

   ```
   http://<LAPTOP_IP>:3000/display
   ```

   مثال:

   ```
   http://192.168.1.50:3000/display
   ```

5. روی دکمه **«شروع»** کلیک کنید تا صدا فعال شود (این کار یک بار لازم است).
6. حالا تلویزیون آماده دریافت فراخوانی‌ها است.

### ترفندها

- اگر تلویزیون از حالت Sleep خارج شود، صفحه Display ممکن است نیاز به reload داشته باشد.
- برای تلویزیون‌های Samsung/LG، می‌توانید از مرورگر داخلی TV استفاده کنید.
- برای پایداری بیشتر، تلویزیون را به جای Wi-Fi با کابل LAN به شبکه وصل کنید.

---

## تنظیمات فایروال ویندوز

اگر تلویزیون نمی‌تواند به سرور وصل شود، احتمالاً فایروال ویندوز پورت 3000 را بسته است.

### راه 1: PowerShell (Admin)

```powershell
# باز کردن پورت 3000 برای TCP در شبکه‌های Private
New-NetFirewallRule -DisplayName "Clerk App - TCP 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

### راه 2: از طریق GUI

1. `Windows Defender Firewall with Advanced Security` را باز کنید.
2. روی `Inbound Rules` کلیک کنید.
3. `New Rule...` را بزنید.
4. `Port` را انتخاب کنید → `TCP` → `Specific local ports: 3000`.
5. `Allow the connection`.
6. فقط `Private` (و `Domain` اگر نیاز دارید) را تیک بزنید.
7. نامی مثل `Clerk App` بگذارید و ذخیره کنید.

### تست دسترسی

از روی تلویزیون (یا هر دستگاه دیگری در LAN) سعی کنید:

```
http://<LAPTOP_IP>:3000/api/health
```

اگر پاسخ `{"ok":true,...}` گرفتید، اتصال برقرار است.

---

## آپلود فایل صوتی

1. در پنل Admin، روی **«افزودن شخص»** یا **«ویرایش»** کلیک کنید.
2. اطلاعات شخص (شماره و نام) را وارد کنید.
3. در بخش **«فایل صوتی»**، روی دکمه انتخاب فایل کلیک کنید.
4. فایل صوتی با یکی از فرمت‌های زیر را انتخاب کنید:
   - **MP3** (`audio/mpeg`)
   - **WAV** (`audio/wav`)
   - **OGG** (`audio/ogg`)
5. حجم فایل نباید بیشتر از **10 مگابایت** باشد (قابل تنظیم در `.env`).
6. پیش‌نمایش فایل را با دکمه **«پخش»** تست کنید.
7. روی **«ذخیره»** کلیک کنید.

### امنیت آپلود

- نام اصلی فایل هرگز برای مسیر ذخیره‌سازی استفاده نمی‌شود.
- یک نام تصادفی ۱۶ کاراکتری هگز (مثل `7f3c1d2a3b4c5d6e.mp3`) تولید می‌شود.
- File extension و MIME type هر دو validate می‌شوند.
- Path traversal کاملاً بسته شده است.
- اگر فایل جدید آپلود شود، فایل قبلی به صورت امن حذف می‌شود (فقط بعد از موفقیت آپلود جدید).

---

## ساختار پروژه

```
.
├── prisma/
│   └── schema.prisma           # Prisma schema (Person, QueueItem, Display, CallHistory)
├── uploads/audio/              # فایل‌های صوتی آپلود شده
├── db/                          # دیتابیس SQLite
├── src/
│   ├── server/
│   │   ├── app.ts              # نقطه ورودی سرور
│   │   ├── config/             # پیکربندی از .env
│   │   ├── routes/             # REST API routes
│   │   │   ├── people.ts
│   │   │   ├── queue.ts
│   │   │   └── history.ts
│   │   ├── websocket/
│   │   │   ├── server.ts       # WsServer class
│   │   │   └── handler.ts     # Business logic handler
│   │   ├── services/
│   │   │   ├── prisma.ts       # Prisma singleton
│   │   │   ├── personService.ts
│   │   │   ├── queueService.ts
│   │   │   ├── displayService.ts
│   │   │   └── historyService.ts
│   │   ├── storage/
│   │   │   └── audioStorage.ts # آپلود امن فایل صوتی
│   │   └── utils/
│   │       ├── logger.ts
│   │       └── errors.ts
│   ├── client/
│   │   ├── admin/              # پنل مدیریت (React)
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── index.html
│   │   ├── display/            # صفحه نمایش (React)
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── index.html
│   │   ├── components/
│   │   │   ├── Toast.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── PersonFormModal.tsx
│   │   │   ├── PeopleGrid.tsx
│   │   │   ├── QueuePanel.tsx
│   │   │   ├── DisplaysList.tsx
│   │   │   └── HistoryModal.tsx
│   │   ├── hooks/
│   │   │   └── useAdminWs.ts
│   │   ├── websocket/
│   │   │   ├── WsClient.ts     # WebSocket client با reconnect
│   │   │   └── api.ts          # REST API helper
│   │   └── styles/
│   │       └── index.css
│   └── shared/
│       └── websocket-types/
│           └── index.ts        # Type-safe WS protocol
├── scripts/                    # تست‌ها
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── tsconfig.client.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── vitest.config.ts
└── .env
```

---

## پیکربندی

تمام پیکربندی‌ها از فایل `.env` خوانده می‌شوند:

```env
# Server
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL=file:./db/custom.db

# Audio Upload
MAX_AUDIO_SIZE=10485760                    # 10 MB
ALLOWED_AUDIO_TYPES=audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/ogg,audio/vorbis

# Queue behavior
DUPLICATE_ALLOWED=false                    # اگر true، اجازه فراخوانی تکراری می‌دهد

# Environment
NODE_ENV=development
```

تغییرات را ذخیره کنید و سرور را restart کنید.

---

## WebSocket Protocol

تمام پیام‌های WebSocket به صورت JSON و type-safe هستند (تعریف شده در `src/shared/websocket-types/index.ts`).

### Client → Server

| Type | Payload | توضیح |
|------|---------|-------|
| `REGISTER` | `{clientType, displayId?, displayName?}` | ثبت نوع کلاینت |
| `CALL_PERSON` | `{personId, displayId?}` | فراخوانی یک شخص |
| `REPLAY` | `{displayId?}` | تکرار آخرین فراخوانی |
| `SKIP` | `{queueItemId}` | رد کردن آیتم فعلی |
| `CANCEL` | `{queueItemId}` | لغو آیتم |
| `DELETE_QUEUE_ITEM` | `{queueItemId}` | حذف آیتم از صف |
| `CLEAR_QUEUE` | — | پاک کردن کل صف |
| `PING` | — | heartbeat |
| `QUEUE_ITEM_STARTED` | `{queueItemId}` | Display گزارش شروع پخش |
| `QUEUE_ITEM_COMPLETED` | `{queueItemId}` | Display گزارش اتمام پخش |
| `QUEUE_ITEM_FAILED` | `{queueItemId, error?}` | Display گزارش خطا |

### Server → Client

| Type | Payload | توضیح |
|------|---------|-------|
| `REGISTERED` | `{clientId, clientType}` | تایید ثبت |
| `QUEUE_UPDATED` | `{current, waiting}` | آپدیت وضعیت صف |
| `CALL_STARTED` | `{queueItem}` | شروع فراخوانی روی display |
| `QUEUE_ITEM_STARTED` | `{queueItem}` | broadcast به admin |
| `QUEUE_ITEM_COMPLETED` | `{queueItemId}` | broadcast به admin |
| `QUEUE_ITEM_CANCELLED` | `{queueItemId}` | broadcast به admin |
| `REPLAY_RESULT` | `{queueItem}` | نتیجه replay |
| `DISPLAYS_UPDATED` | `{displays}` | لیست displays |
| `DISPLAY_STATUS` | `{displayId, connected}` | وضعیت یک display |
| `SYNC_STATE` | `{current, waiting}` | همگام‌سازی بعد از reconnect |
| `PONG` | — | پاسخ به PING |
| `ERROR` | `{code, message, details?}` | خطا |

---

## REST API

### افراد (People)

| Method | Endpoint | توضیح |
|--------|----------|-------|
| `GET` | `/api/people?includeInactive=false` | لیست افراد فعال |
| `POST` | `/api/people` | ایجاد شخص جدید |
| `GET` | `/api/people/:id` | دریافت یک شخص |
| `PUT` | `/api/people/:id` | ویرایش شخص |
| `DELETE` | `/api/people/:id` | حذف شخص |
| `POST` | `/api/people/:id/audio` | آپلود فایل صوتی (multipart) |
| `DELETE` | `/api/people/:id/audio` | حذف فایل صوتی |

### فراخوانی (Calls)

| Method | Endpoint | توضیح |
|--------|----------|-------|
| `POST` | `/api/calls` | `{personId, displayId?}` — فراخوانی |
| `POST` | `/api/calls/replay` | `{displayId?}` — تکرار آخرین |

### صف (Queue)

| Method | Endpoint | توضیح |
|--------|----------|-------|
| `GET` | `/api/queue` | دریافت snapshot صف |
| `DELETE` | `/api/queue/:id` | حذف آیتم از صف |
| `POST` | `/api/queue/:id/cancel` | لغو آیتم |
| `POST` | `/api/queue/:id/skip` | رد کردن آیتم |
| `POST` | `/api/queue/clear` | پاک کردن صف (`{includePlaying}`) |

### Displays

| Method | Endpoint | توضیح |
|--------|----------|-------|
| `GET` | `/api/displays` | لیست displays |

### تاریخچه

| Method | Endpoint | توضیح |
|--------|----------|-------|
| `GET` | `/api/history?limit=100&offset=0&search=` | لیست تاریخچه |

### سلامت

| Method | Endpoint | توضیح |
|--------|----------|-------|
| `GET` | `/api/health` | چک سلامت سرور |

---

## مدیریت صف

### Source of Truth

سرور منبع حقیقت است. کلاینت‌ها (Admin و Display) فقط state را از سرور دریافت می‌کنند و تصمیم‌گیری در مورد Queue روی سرور انجام می‌شود.

### روند فراخوانی

1. Admin روی شماره کلیک می‌کند → `CALL_PERSON` به سرور.
2. سرور Person را در Queue اضافه می‌کند (با بررسی duplicate).
3. سرور `QUEUE_UPDATED` به همه (Admin و Displays) ارسال می‌کند.
4. سرور آیتم بعدی WAITING را برمی‌دارد و اگر Display آنلاین باشد:
   - آن را در DB به `PLAYING` تغییر می‌دهد.
   - `CALL_STARTED` به Display هدف می‌فرستد.
5. Display فایل صوتی را پخش می‌کند:
   - `QUEUE_ITEM_STARTED` به سرور می‌فرستد (تایید شروع).
   - بعد از `ended` شدن: `QUEUE_ITEM_COMPLETED` می‌فرستد.
6. سرور آیتم را `COMPLETED` می‌کند و به CallHistory اضافه می‌کند.
7. سرور آیتم بعدی را dispatch می‌کند (اگر موجود باشد).

### جلوگیری از duplicate

اگر `DUPLICATE_ALLOWED=false` (پیش‌فرض)، فراخوانی همان شخص در حالی که WAITING یا PLAYING است، با خطای `409 DUPLICATE_CALL` رد می‌شود.

---

## Recovery و Restart

### Queue Recovery

هنگام startup سرور:

1. تمام آیتم‌های `PLAYING` به `WAITING` برمی‌گردند (چون نمی‌توانیم بدانیم آیا پخش کامل شده یا خیر).
2. آیتم‌های `WAITING` دست‌نخورده باقی می‌مانند.
3. وقتی یک Display وصل می‌شود، آیتم بعدی WAITING به آن dispatch می‌شود.

### Cleanup فایل‌های Orphan

هنگام startup:

- همه فایل‌های صوتی موجود در `uploads/audio/` بررسی می‌شوند.
- اگر فایلی به هیچ Person اشاره نشده باشد (مثلاً Person حذف شده)، آن فایل حذف می‌شود.

### حذف Person

اگر یک Person حذف شود:

- فایل صوتی او از دیسک حذف می‌شود.
- تمام QueueItemهای مربوطه cascade-delete می‌شوند (به دلیل `onDelete: Cascade` در Prisma).
- تمام رکوردهای CallHistory مربوطه cascade-delete می‌شوند.

---

## تست‌ها

تست‌های زیر وجود دارند:

- **PersonService**: افزودن، حذف، ویرایش، toggle active، duplicate prevention
- **QueueService**: enqueue، dequeue، start، complete، cancel، skip، replay، clear، recovery
- **AudioStorage**: path traversal، MIME validation، file size، atomic swap

### اجرای تست‌ها

```bash
npm test
```

---

## عیب‌یابی

### تلویزیون نمی‌تواند به سرور وصل شود

1. **IP صحیح است؟** با `ipconfig`/`ifconfig` چک کنید.
2. **پورت باز است؟** فایروال را چک کنید (بخش [تنظیمات فایروال](#تنظیمات-فایروال-ویندوز)).
3. **همان شبکه؟** تلویزیون و لپ‌تاپ باید به همان شبکه متصل باشند.
4. **Test دسترسی**: از روی تلویزیون آدرس `http://<IP>:3000/api/health` را باز کنید.
5. **IP محلی**: اگر IP شروع به `169.254` می‌شود، یعنی شبکه درست نیست.

### WebSocket قطع می‌شود

- Display به صورت خودکار با exponential backoff (1s, 2s, 4s, ..., max 30s) reconnect می‌کند.
- اگر قطعی پایدار است، چک کنید که سرور در حال اجراست.
- در Console مرورگر، خطاهای WebSocket را بررسی کنید.

### صدا پخش نمی‌شود

1. **فعال‌سازی صدا**: حتماً یک بار روی دکمه «شروع» در Display کلیک شده باشد (مدیریت autoplay browser).
2. **فایل صوتی موجود است؟** در پنل Admin چک کنید که شخص فایل صوتی داشته باشد.
3. **فرمت صحیح است؟** MP3، WAV یا OGG.
4. **Console errors**: در Console مرورگر TV خطاهای audio را ببینید.
5. **Volume TV**: صدای تلویزیون را چک کنید.

### Admin آیتم‌ها را در صف نمی‌بیند

- WebSocket Status در Header چک کنید (🟢 متصل).
- اگر قطع است، صفحه را reload کنید.
- می‌توانید مستقیماً `GET /api/queue` را تست کنید.

### سرور crash کرد

- لاگ سرور را چک کنید.
- مطمئن شوید دیتابیس در `db/custom.db` قابل نوشتن است.
- اگر schema تغییر کرده: `npm run db:setup` مجدداً اجرا کنید.

### خطای «شماره قبلاً ثبت شده»

شماره در Person باید unique باشد. در صورت تغییر شماره به شماره موجود، این خطا می‌آید.

### Reconnect نکردن تلویزیون بعد از restart سرور

- صفحه Display را reload کنید (کلید F5).
- اگر باز هم نشد، آدرس URL را دوباره وارد کنید.

---

## امنیت

این پروژه برای LAN-only طراحی شده، اما اقدامات امنیتی زیر اعمال شده‌اند:

- ✅ **Path Traversal**: تمام دسترسی‌های filesystem به `uploads/audio/` محدود شده‌اند.
- ✅ **Filename Sanitization**: نام اصلی فایل هرگز برای مسیر استفاده نمی‌شود.
- ✅ **MIME Validation**: فقط فرمت‌های مجاز قبول می‌شوند.
- ✅ **Extension Validation**: فقط `.mp3`، `.wav`، `.ogg`.
- ✅ **File Size Limit**: حداکثر 10MB (قابل تنظیم).
- ✅ **SQL Injection**: Prisma از parameterized queries استفاده می‌کند.
- ✅ **No Internal File Exposure**: فقط فایل‌های داخل `uploads/audio/` serve می‌شوند.
- ✅ **Database Not Exposed**: SQLite file به صورت مستقیم قابل دسترسی از HTTP نیست.
- ✅ **Input Validation**: تمام inputها validate می‌شوند.
- ✅ **Malformed Request Rejection**: پیام‌های WebSocket نامعتبر رد می‌شوند.
- ✅ **Admin Authorization**: عملیات حساس فقط از کلاینت نوع `admin` قبول می‌شوند.

---

## توسعه‌دهنده

### اضافه کردن Migration جدید

```bash
npx prisma migrate dev --name <name>
```

### Reset دیتابیس

```bash
rm -f db/custom.db
npm run db:setup
```

### Build Production

```bash
npm run build
npm start
```

### TypeScript Type Check

```bash
npm run typecheck
```

---

## لایسنس

MIT License

---

## نویسنده

سیستم فراخوانی افراد (Clerk App)
