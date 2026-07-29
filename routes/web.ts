import { auth, dispatch, Mail, Route, view } from "struxjs";
import { SendLoginNotifyJob } from "../app/Jobs/SendLoginNotifyJob.js";
import { WelcomeMail } from "../app/Mail/WelcomeMail.js";

// routes/web.ts (Web Application Routes)
Route.get('/', () => {
    // Mail.to('hoangan.web@gmail.com').queue(new WelcomeMail())
    return view('welcome')
}).middleware(["throttle:5,1"])

Route.get('/admin/dashboard', 'Admin/DashboardController@index').middleware(['auth']);

Route.get('/login', 'LoginController@index')
Route.post('/login', 'LoginController@login')
Route.get('/logout', 'LoginController@logout');

Route.get('/photos', 'PhotoController@index');
Route.get('/photos/:id', 'PhotoController@show');