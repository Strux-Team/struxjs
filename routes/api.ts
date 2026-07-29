// routes/api.ts (API Routes - Automatically prefixed with /api)
import { Route } from "struxjs";

Route.post('/login', 'Api/LoginController@index');
Route.get('/profile', 'Api/LoginController@profile').middleware(["throttle:5,1", 'apiauth']);
Route.post('/refresh', 'Api/LoginController@refresh');
Route.delete('/logout', 'Api/LoginController@logout');