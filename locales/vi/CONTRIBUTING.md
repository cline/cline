[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • <b>Tiếng Việt</b> • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Đóng góp cho Roo Code

Roo Code là một dự án do cộng đồng dẫn dắt và chúng mình rất trân trọng mọi đóng góp. Để đảm bảo quy trình diễn ra suôn sẻ và hiệu quả cho tất cả mọi người, **chúng mình áp dụng nguyên tắc "[Issue-First](#2-nguyên-tắc-chính-cách-tiếp-cận-issue-first)".** Điều này có nghĩa là mọi công việc đều phải liên kết với một Issue trên GitHub _trước khi_ gửi Pull Request (xem [Chính sách PR](#chính-sách-pull-request-pr) để biết chi tiết). Hãy đọc kỹ hướng dẫn này để hiểu cách đóng góp.
Hướng dẫn này giải thích cách đóng góp cho Roo Code, dù bạn sửa lỗi, thêm tính năng mới hay cải thiện tài liệu.

## Mục lục

- [I. Trước khi đóng góp](#i-trước-khi-đóng-góp)
    - [1. Quy tắc ứng xử](#1-quy-tắc-ứng-xử)
    - [2. Hiểu lộ trình phát triển dự án](#2-hiểu-lộ-trình-phát-triển-dự-án)
        - [Hỗ trợ nhà cung cấp](#hỗ-trợ-nhà-cung-cấp)
        - [Hỗ trợ mô hình](#hỗ-trợ-mô-hình)
        - [Hỗ trợ hệ thống](#hỗ-trợ-hệ-thống)
        - [Tài liệu](#tài-liệu)
        - [Ổn định](#ổn-định)
        - [Quốc tế hóa](#quốc-tế-hóa)
    - [3. Tham gia cộng đồng Roo Code](#3-tham-gia-cộng-đồng-roo-code)
- [II. Tìm kiếm & lên kế hoạch đóng góp](#ii-tìm-kiếm--lên-kế-hoạch-đóng-góp)
    - [1. Các loại đóng góp](#1-các-loại-đóng-góp)
    - [2. Nguyên tắc chính: Cách tiếp cận Issue-First](#2-nguyên-tắc-chính-cách-tiếp-cận-issue-first)
    - [3. Quyết định việc cần làm](#3-quyết-định-việc-cần-làm)
    - [4. Báo cáo lỗi hoặc vấn đề](#4-báo-cáo-lỗi-hoặc-vấn-đề)
- [III. Quy trình phát triển & gửi bài](#iii-quy-trình-phát-triển--gửi-bài)
    - [1. Thiết lập môi trường phát triển](#1-thiết-lập-môi-trường-phát-triển)
    - [2. Hướng dẫn viết mã](#2-hướng-dẫn-viết-mã)
    - [3. Gửi mã: Quy trình Pull Request (PR)](#3-gửi-mã-quy-trình-pull-request-pr)
        - [Pull Request nháp](#pull-request-nháp)
        - [Mô tả Pull Request](#mô-tả-pull-request)
        - [Chính sách Pull Request (PR)](#chính-sách-pull-request-pr)
            - [Mục tiêu](#mục-tiêu)
            - [Cách tiếp cận Issue-First](#cách-tiếp-cận-issue-first)
            - [Điều kiện cho PR mở](#điều-kiện-cho-pr-mở)
            - [Quy trình](#quy-trình)
            - [Trách nhiệm](#trách-nhiệm)
- [IV. Pháp lý](#iv-pháp-lý)
    - [Thỏa thuận đóng góp](#thỏa-thuận-đóng-góp)

## I. Trước khi đóng góp

Trước tiên, hãy làm quen với các tiêu chuẩn cộng đồng và định hướng dự án.

### 1. Quy tắc ứng xử

Tất cả thành viên đóng góp phải tuân thủ [Quy tắc ứng xử](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md) của chúng mình. Hãy đọc kỹ trước khi đóng góp.

### 2. Hiểu lộ trình phát triển dự án

Roo Code có lộ trình phát triển rõ ràng, định hướng ưu tiên và tương lai của dự án. Hiểu lộ trình này giúp bạn:

- Định hướng đóng góp phù hợp với mục tiêu dự án
- Xác định lĩnh vực bạn có thể đóng góp tốt nhất
- Hiểu bối cảnh đằng sau các quyết định thiết kế
- Lấy cảm hứng cho các tính năng mới phù hợp với tầm nhìn của dự án

Lộ trình hiện tại tập trung vào 6 trụ cột chính:

#### Hỗ trợ nhà cung cấp

Chúng mình muốn hỗ trợ càng nhiều nhà cung cấp càng tốt:

- Hỗ trợ "Tương thích OpenAI" nhiều hơn
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Tăng cường hỗ trợ Ollama và LM Studio

#### Hỗ trợ mô hình

Chúng mình muốn Roo hoạt động tốt trên nhiều mô hình nhất có thể, kể cả mô hình cục bộ:

- Hỗ trợ mô hình cục bộ qua prompt hệ thống và workflow tùy chỉnh
- Đánh giá benchmark và test case

#### Hỗ trợ hệ thống

Chúng mình muốn Roo chạy tốt trên mọi máy tính:

- Tích hợp terminal đa nền tảng
- Hỗ trợ mạnh mẽ và ổn định cho Mac, Windows, Linux

#### Tài liệu

Chúng mình muốn có tài liệu đầy đủ, dễ tiếp cận cho mọi người dùng và cộng tác viên:

- Hướng dẫn và tài liệu mở rộng
- Tài liệu API rõ ràng
- Hướng dẫn tốt hơn cho cộng tác viên
- Tài nguyên tài liệu đa ngôn ngữ
- Ví dụ tương tác và đoạn mã mẫu

#### Ổn định

Chúng mình muốn giảm đáng kể số lỗi và tăng cường kiểm thử tự động:

- Công tắc bật/tắt log debug
- Nút "Sao chép thông tin máy/tác vụ" cho yêu cầu hỗ trợ/bug

#### Quốc tế hóa

Chúng mình muốn Roo nói được ngôn ngữ của mọi người:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

Chúng mình đặc biệt hoan nghênh các đóng góp giúp tiến gần hơn tới mục tiêu lộ trình. Nếu bạn làm việc liên quan đến các trụ cột này, hãy đề cập trong mô tả PR.

### 3. Tham gia cộng đồng Roo Code

Kết nối với cộng đồng Roo Code là cách tuyệt vời để bắt đầu:

- **Cách chính**:
    1.  Tham gia [cộng đồng Roo Code trên Discord](https://discord.gg/roocode).
    2.  Sau khi tham gia, gửi tin nhắn trực tiếp (DM) cho **Hannes Rudolph** (Discord: `hrudolph`) để trao đổi về mong muốn đóng góp và nhận hướng dẫn.
- **Dành cho cộng tác viên giàu kinh nghiệm**: Nếu bạn quen với cách tiếp cận issue-first, có thể tham gia trực tiếp trên GitHub bằng cách theo dõi [bảng Kanban](https://github.com/orgs/RooVetGit/projects/1) và trao đổi qua issues, pull requests.

## II. Tìm kiếm & lên kế hoạch đóng góp

Xác định bạn muốn làm gì và cách thực hiện.

### 1. Các loại đóng góp

Chúng mình hoan nghênh nhiều hình thức đóng góp:

- **Sửa lỗi**: Khắc phục vấn đề trong mã nguồn hiện tại
- **Tính năng mới**: Thêm chức năng mới
- **Tài liệu**: Cải thiện hướng dẫn, ví dụ hoặc sửa lỗi chính tả

### 2. Nguyên tắc chính: Cách tiếp cận Issue-First

**Mọi đóng góp đều phải bắt đầu bằng một Issue trên GitHub.** Đây là bước quan trọng để đảm bảo sự đồng thuận và tránh lãng phí công sức.

- **Tìm hoặc tạo Issue**:
    - Trước khi bắt đầu, hãy kiểm tra [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) xem đã có issue cho đóng góp của bạn chưa.
    - Nếu có và chưa được gán, hãy bình luận để nhận việc. Một maintainer sẽ gán cho bạn.
    - Nếu chưa có, hãy tạo issue mới bằng template phù hợp trên [trang issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose):
        - Sửa lỗi: dùng template "Bug Report"
        - Tính năng mới: dùng template "Detailed Feature Proposal". Đợi maintainer (đặc biệt là @hannesrudolph) duyệt trước khi bắt đầu làm.
        - **Lưu ý**: Ý tưởng chung hoặc thảo luận ban đầu về tính năng có thể bắt đầu ở [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests). Khi ý tưởng rõ ràng hơn, hãy tạo issue "Detailed Feature Proposal".
- **Nhận việc và được gán**:
    - Bình luận rõ ràng để nhận việc trên issue.
    - Đợi maintainer gán chính thức trên GitHub để tránh trùng lặp công việc.
- **Nếu không tuân thủ**:
    - Pull Request (PR) gửi mà không có issue liên quan, được duyệt và gán trước có thể bị đóng mà không review đầy đủ. Chính sách này nhằm đảm bảo đóng góp phù hợp với ưu tiên dự án và tôn trọng thời gian của mọi người.

Cách này giúp chúng mình theo dõi công việc, đảm bảo thay đổi là cần thiết và phối hợp hiệu quả.

### 3. Quyết định việc cần làm

- **Good First Issues**: Xem mục "Issue [Unassigned]" trên [Dự án Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) trên GitHub.
- **Tài liệu**: Dù `CONTRIBUTING.md` là hướng dẫn chính cho đóng góp mã nguồn, nếu bạn muốn đóng góp cho tài liệu khác (hướng dẫn người dùng, API...), hãy xem [repo Roo Code Docs](https://github.com/RooVetGit/Roo-Code-Docs) hoặc hỏi trên Discord.
- **Đề xuất tính năng mới**:
    1.  **Ý tưởng/thảo luận ban đầu**: Với ý tưởng chung hoặc mới, hãy bắt đầu thảo luận ở [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests).
    2.  **Đề xuất chính thức**: Với đề xuất cụ thể, sẵn sàng thực hiện, hãy tạo issue "Detailed Feature Proposal" bằng template trên [trang issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose). Đây là phần quan trọng của **cách tiếp cận Issue-First**.

### 4. Báo cáo lỗi hoặc vấn đề

Nếu bạn phát hiện lỗi:

1.  **Tìm issue đã có**: Kiểm tra [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) xem đã có ai báo cáo chưa.
2.  **Tạo issue mới**: Nếu chưa có, dùng template "Bug Report" trên [trang issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose).

> 🔐 **Lỗ hổng bảo mật**: Nếu phát hiện lỗ hổng bảo mật, hãy báo cáo riêng qua [GitHub Security Advisory Tool](https://github.com/RooVetGit/Roo-Code/security/advisories/new). Không tạo issue công khai cho lỗ hổng bảo mật.

## III. Quy trình phát triển & gửi bài

Làm theo các bước sau để lập trình và gửi đóng góp.

### 1. Thiết lập môi trường phát triển

1.  **Fork & Clone**:
    - Fork repo trên GitHub.
    - Clone repo về máy: `git clone https://github.com/TEN_TAI_KHOAN/Roo-Code.git`
2.  **Cài đặt phụ thuộc**: `npm run install:all`
3.  **Chạy Webview (Dev Mode)**: `npm run dev` (cho app Vite/React với HMR)
4.  **Debug extension**: Nhấn `F5` trong VS Code (hoặc **Run** → **Start Debugging**) để mở cửa sổ Extension Development Host với Roo Code đã nạp.

Thay đổi ở webview (`webview-ui`) sẽ xuất hiện ngay nhờ Hot Module Replacement. Thay đổi ở extension chính (`src`) cần khởi động lại Extension Development Host.

Hoặc, để build và cài đặt gói `.vsix`:

```sh
npm run build
code --install-extension bin/roo-cline-<phiên-bản>.vsix
```

(Thay `<phiên-bản>` bằng số phiên bản thực tế của file đã build.)

### 2. Hướng dẫn viết mã

- **PR tập trung**: Mỗi PR chỉ nên có một tính năng/sửa lỗi.
- **Chất lượng mã**:
    - Vượt qua các kiểm tra CI (lint, format)
    - Sửa cảnh báo/lỗi ESLint (`npm run lint`)
    - Phản hồi góp ý từ công cụ review mã tự động
    - Tuân thủ best practice TypeScript và đảm bảo an toàn kiểu dữ liệu
- **Kiểm thử**:
    - Thêm test cho tính năng mới
    - Chạy `npm test` để đảm bảo mọi test đều pass
    - Cập nhật test hiện có nếu thay đổi ảnh hưởng đến chúng
- **Thông điệp commit**:
    - Viết rõ ràng, mô tả đầy đủ
    - Tham chiếu issue liên quan bằng `#số-issue` (vd: `Fixes #123`)
- **Checklist trước khi gửi PR**:
    - Rebase branch lên `main` mới nhất từ upstream
    - Đảm bảo mã build thành công (`npm run build`)
    - Tất cả test phải pass (`npm test`)
    - Xóa mã debug hoặc `console.log`

### 3. Gửi mã: Quy trình Pull Request (PR)

#### Pull Request nháp

Dùng PR nháp cho công việc chưa sẵn sàng review đầy đủ nhưng bạn muốn:

- Chạy kiểm tra tự động (CI)
- Nhận góp ý sớm từ maintainer hoặc cộng tác viên khác
- Thể hiện công việc đang tiến hành

Chỉ đánh dấu PR là "Ready for Review" khi mọi kiểm tra đều pass và bạn tin rằng đã đáp ứng tiêu chí "Hướng dẫn viết mã" và "Mô tả Pull Request".

#### Mô tả Pull Request

Mô tả PR phải đầy đủ và theo cấu trúc của [Template Pull Request](.github/pull_request_template.md). Các điểm chính:

- Link đến Issue đã duyệt trên GitHub mà PR giải quyết
- Mô tả rõ ràng thay đổi và mục đích
- Bước kiểm thử chi tiết
- Danh sách breaking changes (nếu có)
- **Với thay đổi UI, cung cấp ảnh/video trước/sau**
- **Chỉ rõ nếu PR cần cập nhật tài liệu người dùng và tài liệu/section nào bị ảnh hưởng**

#### Chính sách Pull Request (PR)

##### Mục tiêu

Duy trì backlog PR sạch, tập trung và dễ quản lý.

##### Cách tiếp cận Issue-First

- **Bắt buộc**: Trước khi bắt đầu, phải có Issue trên GitHub đã được duyệt và gán (dù là "Bug Report" hay "Detailed Feature Proposal").
- **Duyệt**: Issue, nhất là thay đổi lớn, phải được maintainer (đặc biệt là @hannesrudolph) duyệt _trước_ khi bắt đầu code.
- **Tham chiếu**: PR phải tham chiếu rõ ràng đến các Issue đã duyệt trong mô tả.
- **Hậu quả**: Không tuân thủ có thể khiến PR bị đóng mà không review đầy đủ.

##### Điều kiện cho PR mở

- **Sẵn sàng merge**: Pass mọi kiểm tra CI, phù hợp roadmap (nếu có), liên kết với Issue đã duyệt và gán, có tài liệu/bình luận rõ ràng, có ảnh/video trước/sau cho thay đổi UI
- **Đóng**: Lỗi CI, xung đột merge lớn, không phù hợp mục tiêu dự án hoặc không cập nhật sau góp ý >30 ngày

##### Quy trình

1.  **Duyệt & gán Issue**: @hannesrudolph (hoặc maintainer khác) duyệt và gán Issue mới/cũ.
2.  **Triage PR ban đầu (hàng ngày)**: Maintainer kiểm tra nhanh PR mới để lọc việc khẩn cấp hoặc vấn đề nghiêm trọng.
3.  **Review PR chi tiết (hàng tuần)**: Maintainer review kỹ PR về độ sẵn sàng, phù hợp Issue và chất lượng tổng thể.
4.  **Góp ý chi tiết & lặp lại**: Sau review, maintainer góp ý (Approve, Request Changes, Reject). Cộng tác viên cần phản hồi và chỉnh sửa nếu cần.
5.  **Quyết định**: PR được duyệt sẽ merge. PR có vấn đề không giải quyết được hoặc không phù hợp sẽ bị đóng kèm giải thích.
6.  **Theo dõi**: Tác giả PR bị đóng có thể sửa theo góp ý và mở lại nếu vấn đề được giải quyết hoặc hướng dự án thay đổi.

##### Trách nhiệm

- **Duyệt Issue & tuân thủ quy trình (@hannesrudolph & maintainer)**: Đảm bảo mọi đóng góp tuân thủ cách tiếp cận Issue-First. Hướng dẫn cộng tác viên.
- **Maintainer (Dev Team)**: Review PR, góp ý kỹ thuật, quyết định duyệt/từ chối, merge PR.
- **Cộng tác viên**: Đảm bảo PR liên kết với Issue đã duyệt và gán, tuân thủ hướng dẫn chất lượng, phản hồi nhanh góp ý.

Chính sách này đảm bảo rõ ràng và tích hợp hiệu quả.

## IV. Pháp lý

### Thỏa thuận đóng góp

Khi gửi pull request, bạn đồng ý rằng đóng góp của mình sẽ được cấp phép theo [Giấy phép Apache 2.0](LICENSE) (hoặc giấy phép hiện tại của dự án), giống như dự án.
