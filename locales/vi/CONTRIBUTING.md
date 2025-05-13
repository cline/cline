[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • <b>Tiếng Việt</b> • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Đóng góp cho Roo Code

Roo Code là một dự án do cộng đồng dẫn dắt và chúng mình rất trân trọng mọi đóng góp. Để đơn giản hóa quy trình hợp tác, chúng mình áp dụng cách tiếp cận [Issue-First](#cách-tiếp-cận-issue-first), nghĩa là tất cả [Pull Request (PR)](#gửi-pull-request) phải được liên kết với một GitHub Issue trước. Vui lòng đọc kỹ hướng dẫn này.

## Mục lục

- [Trước khi đóng góp](#trước-khi-đóng-góp)
- [Tìm kiếm & lên kế hoạch đóng góp](#tìm-kiếm--lên-kế-hoạch-đóng-góp)
- [Quy trình phát triển & gửi bài](#quy-trình-phát-triển--gửi-bài)
- [Pháp lý](#pháp-lý)

## Trước khi đóng góp

### 1. Quy tắc ứng xử

Tất cả thành viên đóng góp phải tuân thủ [Quy tắc ứng xử](./CODE_OF_CONDUCT.md) của chúng mình.

### 2. Lộ trình phát triển dự án

Lộ trình của chúng mình định hướng dự án. Hãy điều chỉnh đóng góp của bạn theo các mục tiêu chính:

### Độ tin cậy là ưu tiên hàng đầu

- Đảm bảo việc chỉnh sửa diff và thực thi lệnh luôn đáng tin cậy
- Giảm thiểu các điểm cản trở khiến người dùng ngại sử dụng thường xuyên
- Đảm bảo hoạt động mượt mà trên mọi ngôn ngữ và nền tảng
- Mở rộng hỗ trợ mạnh mẽ cho nhiều nhà cung cấp và mô hình AI đa dạng

### Nâng cao trải nghiệm người dùng

- Đơn giản hóa giao diện người dùng để tăng tính rõ ràng và trực quan
- Liên tục cải thiện quy trình làm việc để đáp ứng kỳ vọng cao của các nhà phát triển

### Dẫn đầu về hiệu suất agent

- Thiết lập các tiêu chuẩn đánh giá toàn diện (evals) để đo lường năng suất trong thực tế
- Giúp mọi người dễ dàng chạy và hiểu các đánh giá này
- Cung cấp các cải tiến thể hiện rõ sự tăng trưởng trong điểm đánh giá

Đề cập đến sự liên quan với các lĩnh vực này trong PR của bạn.

### 3. Tham gia cộng đồng Roo Code

- **Cách chính:** Tham gia [Discord](https://discord.gg/roocode) của chúng mình và nhắn tin trực tiếp cho **Hannes Rudolph (`hrudolph`)**.
- **Cách thay thế:** Cộng tác viên có kinh nghiệm có thể tham gia trực tiếp qua [GitHub Projects](https://github.com/orgs/RooVetGit/projects/1).

## Tìm kiếm & lên kế hoạch đóng góp

### Các loại đóng góp

- **Sửa lỗi:** Khắc phục vấn đề trong mã nguồn.
- **Tính năng mới:** Thêm chức năng mới.
- **Tài liệu:** Cải thiện hướng dẫn và độ rõ ràng.

### Cách tiếp cận Issue-First

Mọi đóng góp đều phải bắt đầu bằng một GitHub Issue.

- **Kiểm tra issue hiện có:** Tìm kiếm trong [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues).
- **Tạo issue mới:** Sử dụng mẫu phù hợp:
    - **Lỗi:** Mẫu "Bug Report".
    - **Tính năng:** Mẫu "Detailed Feature Proposal". Cần được phê duyệt trước khi bắt đầu.
- **Nhận issue:** Bình luận và chờ được gán chính thức.

**PR không có issue đã duyệt có thể bị đóng.**

### Quyết định việc cần làm

- Xem [Dự án GitHub](https://github.com/orgs/RooVetGit/projects/1) để tìm "Good First Issues" chưa được gán.
- Về tài liệu, hãy xem [Roo Code Docs](https://github.com/RooVetGit/Roo-Code-Docs).

### Báo cáo lỗi

- Kiểm tra báo cáo hiện có trước.
- Tạo báo cáo lỗi mới bằng [mẫu "Bug Report"](https://github.com/RooVetGit/Roo-Code/issues/new/choose).
- **Lỗ hổng bảo mật:** Báo cáo riêng qua [security advisories](https://github.com/RooVetGit/Roo-Code/security/advisories/new).

## Quy trình phát triển & gửi bài

### Thiết lập môi trường phát triển

1. **Fork & Clone:**

```
git clone https://github.com/TEN_TAI_KHOAN/Roo-Code.git
```

2. **Cài đặt phụ thuộc:**

```
npm run install:all
```

3. **Debug:** Mở bằng VS Code (`F5`).

### Hướng dẫn viết mã

- Mỗi PR chỉ tập trung vào một tính năng hoặc sửa lỗi.
- Tuân thủ các thực hành tốt nhất của ESLint và TypeScript.
- Viết thông điệp commit rõ ràng, tham chiếu đến issue (ví dụ: `Fixes #123`).
- Cung cấp bài kiểm tra đầy đủ (`npm test`).
- Rebase trên nhánh `main` mới nhất trước khi gửi.

### Gửi Pull Request

- Bắt đầu với **PR nháp** nếu muốn nhận phản hồi sớm.
- Mô tả rõ ràng các thay đổi, tuân theo Mẫu Pull Request.
- Cung cấp ảnh chụp/video cho thay đổi UI.
- Chỉ rõ nếu cần cập nhật tài liệu.

### Chính sách Pull Request

- Phải tham chiếu đến issue đã được phê duyệt và gán.
- PR không tuân thủ chính sách có thể bị đóng.
- PR cần vượt qua kiểm tra CI, phù hợp với lộ trình và có tài liệu rõ ràng.

### Quy trình đánh giá

- **Phân loại hàng ngày:** Kiểm tra nhanh bởi maintainer.
- **Đánh giá chi tiết hàng tuần:** Đánh giá toàn diện.
- **Lặp lại nhanh chóng** dựa trên phản hồi.

## Pháp lý

Khi gửi pull request, bạn đồng ý rằng đóng góp của mình sẽ được cấp phép theo Giấy phép Apache 2.0, phù hợp với giấy phép của Roo Code.
