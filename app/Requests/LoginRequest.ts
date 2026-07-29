import { FormRequest } from "struxjs";

export class LoginRequest extends FormRequest {
    /**
     * Define the validation rules for the request
     */
    public rules(): Record<string, any> {
        return {
            // Define rules, e.g.: "email": "required|email"
        };
    }

    /**
     * Define custom error messages for validation rules (Optional)
     */
    public messages(): Record<string, string> {
        return {};
    }

    /**
     * Define user-friendly attribute names for fields (Optional)
     */
    public attributes(): Record<string, string> {
        return {};
    }
}
