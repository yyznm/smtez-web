# SMT Web 手机端控制

## 项目结构

```text
├── public/              # 静态资源
├── server/              # C++ 插件源代码及构建脚本
│   ├── SmtWebServer.cpp # HTTP/WS 服务端实现
│   ├── build.ps1        # DLL 构建脚本
│   └── smtweb.plugin.json # 插件元数据配置
├── src/
│   ├── api/             # API 接口定义（WebSocket, HTTP）
│   ├── components/      # 通用 UI 组件
│   ├── stores/          # Pinia 状态管理
│   ├── views/           # 页面视图（概览、控制、贴装）
│   ├── App.vue          # 根组件
│   └── main.ts          # 入口文件
├── index.html           # HTML 模板
└── vite.config.ts       # Vite 配置文件
```

## 开发与部署

### 安装依赖

```bash
npm install
```

### 本地开发

启动前端开发服务器：

```bash
npm run dev
```

默认访问地址：`http://localhost:5179`

### 前端打包

将前端代码打包为静态文件：

```bash
npm run build
```

### 构建 C++ 插件 (DLL)

运行以下命令编译后端插件：

```bash
npm run build:dll
```

该命令会调用 `server/build.ps1` 脚本，在 `server/bin` 目录下生成 `smtweb.dll` 和 `smtweb.plugin.json`。
