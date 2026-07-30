# Cross-Origin Resource Sharing (CORS)

StruxJS natively supports CORS (Cross-Origin Resource Sharing) out of the box using `@fastify/cors`. CORS allows you to configure which external domains, HTTP methods, and headers are permitted to interact with your application's API.

## Configuration

By default, the framework will automatically apply CORS configuration globally. You can configure your CORS settings in the `config/cors.ts` file of your application.

```typescript
// config/cors.ts
import { env } from "struxjs";

export default {
    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    */

    enabled: env("CORS_ENABLED", true),

    origin: ["*"],

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-XSRF-TOKEN"],

    exposedHeaders: [],

    credentials: true,

    maxAge: 86400,
};
```

### Options Explained

- **enabled**: Set to `false` to completely disable CORS across the application.
- **origin**: Defines the `Access-Control-Allow-Origin` header. You can specify a single string (e.g. `'http://localhost:3000'`), an array of strings, or `'*'` to allow all origins.
- **methods**: Defines the `Access-Control-Allow-Methods` header. Lists the allowed HTTP verbs.
- **allowedHeaders**: Defines the `Access-Control-Allow-Headers` header. These are the headers the client is allowed to send.
- **exposedHeaders**: Defines the `Access-Control-Expose-Headers` header. These are the headers the browser is allowed to access from the response.
- **credentials**: Defines the `Access-Control-Allow-Credentials` header. Set this to `true` if your API needs to support cookies or authorization headers.
- **maxAge**: Defines the `Access-Control-Max-Age` header in seconds, which tells the browser how long the results of a preflight request can be cached.

## Environment Variables

You can easily toggle CORS on or off across different environments by defining the `CORS_ENABLED` environment variable in your `.env` file:

```ini
CORS_ENABLED=true
```

## How It Works

Under the hood, StruxJS intercepts all incoming requests and automatically responds to `OPTIONS` preflight requests using your configuration. The relevant CORS headers are also appended to the actual responses. Because it runs globally at the Fastify level, it protects both your web routes and API routes seamlessly.
