import { FormRequest } from "struxjs";

export class RegisterRequest extends FormRequest {

    public rules(): Record<string, string> {
        return {
            username: "required|alpha_num|min:4",
            email: "required|email|unique:users,email",
            password: "required|min:8|confirmed"
        };
    }

    public messages(): Record<string, string> {
        return {
            "email.unique": "Địa chỉ hộp thư điện tử này đã được đăng ký trước đó.",
            "password.confirmed": "Mật khẩu xác nhận nhập lại không khớp."
        };
    }

    public attributes(): Record<string, string> {
        return {
            username: "tên tài khoản",
            email: "địa chỉ email",
            password: "mật khẩu bảo mật"
        };
    }
}