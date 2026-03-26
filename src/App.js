import React, { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
  setDoc,
  where,
  getDocs,
} from "firebase/firestore";

// CẤU HÌNH FIREBASE CỦA TIỆM
const appId = "tiem-may-veston-si-hien";
const firebaseConfig = {
  apiKey: "AIzaSyDuB85lWrkVb0DAnTyxIp6sUERdbWcQAow",
  authDomain: "trung-tam-veston-si-hien.firebaseapp.com",
  projectId: "trung-tam-veston-si-hien",
  storageBucket: "trung-tam-veston-si-hien.firebasestorage.app",
  messagingSenderId: "136164117027",
  appId: "1:136164117027:web:6f47ce84ab91d4ceb3bf96",
};

// 🔒 MÃ PIN BÍ MẬT DÀNH RIÊNG CHO CHỦ TIỆM
const ADMIN_PASSCODE = "2004";
let db;
let auth;
let OWNER_ID = null;

const formatCurrency = (amount) => {
  const numericAmount = String(amount || "0").replace(/\D/g, "");
  if (!numericAmount) return "0";
  return Number(numericAmount).toLocaleString("vi-VN");
};

const formatDate = (dateString) => {
  if (!dateString) return "—";
  try {
    if (dateString.toDate)
      return dateString.toDate().toLocaleDateString("vi-VN");
    const dateObj = new Date(dateString);
    return dateObj.toLocaleDateString("vi-VN");
  } catch (e) {
    return dateString || "—";
  }
};

const getStatusColor = (status) => {
  switch (status) {
    case "Đang may":
      return "bg-yellow-100 text-yellow-700 border border-yellow-200";
    case "Hoàn thành":
      return "bg-green-100 text-green-700 border border-green-200";
    case "Đã giao":
      return "bg-blue-100 text-blue-700 border border-blue-200";
    case "Chờ xử lý":
      return "bg-gray-100 text-gray-700 border border-gray-200";
    default:
      return "bg-red-100 text-red-700 border border-red-200";
  }
};

const generateOrderName = (name, phone) => {
  if (!name || !phone) return null;
  const sanitizedName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const phoneDigits = phone.replace(/\D/g, "");
  const lastThreeDigits = phoneDigits.slice(-3);
  return `${sanitizedName.substring(0, 15)}_${lastThreeDigits}`;
};

// ==========================================
// 🚀 TÍNH NĂNG GỬI EMAIL TỰ ĐỘNG
// ==========================================
const sendEmailInvoice = async (customer, showToast) => {
  if (!customer.email) {
    showToast(
      "Khách hàng này chưa có thông tin Email. Bấm 'Sửa Đơn' để thêm email nhé!",
      "error"
    );
    return;
  }
  showToast("Đang gửi email tự động...", "success");
  const EMAILJS_SERVICE_ID = "service_r1rgdnp";
  const EMAILJS_TEMPLATE_ID = "template_2ypt4fw";
  const EMAILJS_PUBLIC_KEY = "gq1x0nWZpwbsYajd0";

  try {
    const response = await fetch(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_TEMPLATE_ID,
          user_id: EMAILJS_PUBLIC_KEY,
          template_params: {
            to_name: customer.name,
            to_email: customer.email,
            order_id: customer.orderName,
            phone: customer.phone,
            receive_date: formatDate(customer.ngayNhan),
            delivery_date: formatDate(customer.ngayGiao),
            status: customer.status,
            total_price: formatCurrency(customer.giaTien),
            deposit: formatCurrency(customer.datTruoc),
            remaining: formatCurrency(customer.conLai),
          },
        }),
      }
    );
    if (response.ok)
      showToast("Đã gửi Hóa Đơn thành công đến email khách hàng!", "success");
    else showToast("Lỗi gửi mail: " + (await response.text()), "error");
  } catch (error) {
    showToast("Không thể kết nối đến máy chủ gửi Mail.", "error");
  }
};

const exportToCSV = (customers) => {
  const headers = [
    "Tên KH",
    "SĐT",
    "Email",
    "Mã Vải",
    "Ngày Nhận",
    "Ngày Giao",
    "Số Lượng",
    "Trạng Thái",
    "Giá Tiền",
    "Đặt Trước",
    "Còn Lại",
    "Tên Đơn Hàng",
    "Ghi Chú",
    "Phân Tích AI",
  ];
  const rows = customers.map((c) => [
    `"${c.name || ""}"`,
    `"${c.phone || ""}"`,
    `"${c.email || ""}"`,
    `"${c.fabricCode || ""}"`,
    `"${c.ngayNhan || ""}"`,
    `"${c.ngayGiao || ""}"`,
    `"${c.soLuong || ""}"`,
    `"${c.status || ""}"`,
    `"${c.giaTien || "0"}"`,
    `"${c.datTruoc || "0"}"`,
    `"${c.conLai || "0"}"`,
    `"${c.orderName || ""}"`,
    `"${(c.notes || "").replace(/\n/g, " ")}"`,
    `"${(c.generatedProfile || "").replace(/\n/g, " ")}"`,
  ]);
  let csvContent =
    "data:text/csv;charset=utf-8,\uFEFF" +
    [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute(
    "download",
    `danh_sach_don_hang_${new Date().getTime()}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const MeasurementInput = ({ label, name, value, onChange }) => (
  <div className="flex flex-col">
    <label className="text-xs font-medium text-gray-700 mb-1">{label}</label>
    <input
      type="text"
      inputMode="numeric"
      name={name}
      value={value || ""}
      onChange={(e) =>
        onChange({ target: { name, value: e.target.value.replace(/\D/g, "") } })
      }
      className="p-2 border rounded-lg bg-white border-gray-300 focus:ring-2 focus:ring-[#133c3e] outline-none transition"
      placeholder="cm"
    />
  </div>
);

const CurrencyInput = ({ label, name, value, onChange, readOnly = false }) => (
  <div className="flex flex-col">
    <label className="text-xs font-medium text-gray-700 mb-1">
      {label} (VNĐ)
    </label>
    <input
      type="text"
      inputMode="numeric"
      name={name}
      value={formatCurrency(value)}
      onChange={(e) =>
        onChange({ target: { name, value: e.target.value.replace(/\D/g, "") } })
      }
      readOnly={readOnly}
      className={`p-2 border rounded-lg outline-none transition ${
        readOnly
          ? "bg-gray-100 text-gray-500 font-bold"
          : "bg-white border-gray-300 focus:ring-2 focus:ring-red-400 font-bold"
      }`}
      placeholder="0"
    />
  </div>
);

const ImageUploadInput = ({ label, value, onChange }) => {
  const [isUploading, setIsUploading] = useState(false);
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 500;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        onChange(canvas.toDataURL("image/jpeg", 0.7));
        setIsUploading(false);
      };
    };
  };
  return (
    <div className="flex flex-col col-span-2 sm:col-span-2">
      <label className="text-xs font-medium text-gray-700 mb-1">{label}</label>
      {value ? (
        <div className="relative mb-2">
          <img
            src={value}
            alt="Mẫu vải"
            className="w-full h-40 object-cover rounded-lg border border-gray-300 shadow-sm"
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-2 right-2 bg-red-500 text-white rounded-full px-3 py-1 text-xs font-bold shadow-md hover:bg-red-600 transition"
          >
            X Xóa ảnh
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="p-2 border rounded-lg bg-white border-gray-300 text-sm focus:ring-[#133c3e] focus:border-[#133c3e] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-[#133c3e]/10 file:text-[#133c3e] hover:file:bg-[#133c3e]/20 cursor-pointer"
        />
      )}
      {isUploading && (
        <span className="text-xs text-[#133c3e] mt-1 animate-pulse">
          Đang nén ảnh...
        </span>
      )}
    </div>
  );
};

// BẢN HIỂN THỊ ĐƠN HÀNG
const CustomerCard = ({ customer, ownerId, appId, db, showToast, role }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCustomer, setEditedCustomer] = useState({ ...customer });
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = role === "admin";

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    const isNumeric = [
      "aoDai",
      "vai",
      "tay",
      "nguc",
      "eo",
      "mong",
      "co",
      "haBen",
      "haEo",
      "quanDai",
      "mongQuan",
      "day",
      "dui",
      "goi",
      "ong",
      "eoQuan",
      "soLuong",
    ].includes(name);
    const finalValue = isNumeric ? value.replace(/\D/g, "") : value;
    setEditedCustomer((prev) => {
      const updated = { ...prev, [name]: finalValue };
      if (name === "giaTien" || name === "datTruoc") {
        const total = parseInt(updated.giaTien?.replace(/\D/g, "") || "0");
        const deposit = parseInt(updated.datTruoc?.replace(/\D/g, "") || "0");
        updated.conLai = (total > deposit ? total - deposit : 0).toString();
      }
      return updated;
    });
  };

  const saveEdit = async () => {
    if (!editedCustomer.name || !editedCustomer.phone)
      return showToast("Tên và SĐT là bắt buộc.", "error");
    try {
      setIsSaving(true);
      await setDoc(
        doc(
          db,
          `artifacts/${appId}/users/${ownerId}/customer_measurements`,
          customer.id
        ),
        {
          ...editedCustomer,
          name: editedCustomer.name.trim(),
          phone: editedCustomer.phone.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setIsEditing(false);
      showToast("Đã cập nhật đơn hàng!", "success");
    } catch (e) {
      showToast("Lỗi cập nhật: " + e.message, "error");
    }
    setIsSaving(false);
  };

  const deleteCustomer = async () => {
    if (
      !window.confirm(
        `Xóa đơn hàng ${customer.name}? Dữ liệu không thể khôi phục!`
      )
    )
      return;
    try {
      await deleteDoc(
        doc(
          db,
          `artifacts/${appId}/users/${ownerId}/customer_measurements`,
          customer.id
        )
      );
      showToast("Đã xóa đơn hàng!", "success");
    } catch (e) {
      showToast("Lỗi xóa: " + e.message, "error");
    }
  };

  const CommonField = ({ label, value, unit = "" }) => (
    <div className="flex flex-col bg-white p-2 rounded border border-gray-100 shadow-sm">
      <span className="text-[10px] uppercase text-gray-400 font-bold">
        {label}
      </span>
      <span className="text-sm font-semibold text-gray-800">
        {value ? value : "—"} {value && unit}
      </span>
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 border border-gray-200 overflow-hidden mb-4">
      <div
        className={`p-4 cursor-pointer flex justify-between items-center transition-colors ${
          isExpanded
            ? "bg-[#133c3e]/5 border-b border-[#133c3e]/10"
            : "hover:bg-gray-50"
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            {customer.name}
            <span
              className={`ml-3 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${getStatusColor(
                customer.status
              )}`}
            >
              {customer.status || "Chờ xử lý"}
            </span>
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            📞 {customer.phone}{" "}
            {customer.fabricCode && `| 🧵 Vải: ${customer.fabricCode}`}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Mã đơn:{" "}
            <span className="font-mono text-[#133c3e] font-bold">
              {customer.orderName}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-sm font-black text-red-600">
            {formatCurrency(customer.conLai)} đ
          </span>
          <span className="text-[10px] text-gray-400 uppercase font-bold">
            Còn nợ
          </span>
          <svg
            className={`w-5 h-5 text-gray-400 mt-2 transform transition-transform ${
              isExpanded ? "rotate-180" : "rotate-0"
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 9l-7 7-7-7"
            ></path>
          </svg>
        </div>
      </div>

      {isExpanded && (
        <div className="p-5 bg-gray-50/50">
          {isAdmin && (
            <div className="flex flex-wrap justify-end gap-2 mb-5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  sendEmailInvoice(customer, showToast);
                }}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 transition shadow-sm"
              >
                ✉️ Gửi Email
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(!isEditing);
                  setEditedCustomer({ ...customer });
                }}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition shadow-sm ${
                  isEditing
                    ? "bg-gray-500 text-white hover:bg-gray-600"
                    : "bg-[#133c3e] text-[#e5c07b] hover:bg-[#0f2d2f] border border-[#e5c07b]"
                }`}
              >
                {isEditing ? "Hủy Sửa" : "✏️ Sửa Đơn"}
              </button>
              <button
                onClick={deleteCustomer}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition shadow-sm"
              >
                🗑️ Xóa
              </button>
            </div>
          )}

          {!isEditing || !isAdmin ? (
            <div className="space-y-5 animate-fade-in">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <CommonField
                  label="Ngày Nhận"
                  value={formatDate(customer.ngayNhan)}
                />
                <CommonField
                  label="Ngày Giao"
                  value={formatDate(customer.ngayGiao)}
                />
                <CommonField label="Email" value={customer.email} />
                <CommonField
                  label="Số lượng"
                  value={customer.soLuong}
                  unit="bộ"
                />
              </div>
              {customer.generatedProfile && (
                <div className="p-4 bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl border border-pink-100 shadow-sm">
                  <h4 className="font-bold text-pink-700 text-sm mb-1 flex items-center gap-1">
                    ✨ AI Phân Tích Vóc Dáng
                  </h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {customer.generatedProfile}
                  </p>
                </div>
              )}
              {customer.fabricImageURL && (
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Ảnh Mẫu Vải
                  </h4>
                  <img
                    src={customer.fabricImageURL}
                    alt="Vải"
                    className="w-full sm:w-1/2 h-auto max-h-48 object-cover rounded-xl shadow-md border border-gray-200"
                  />
                </div>
              )}
              <div>
                <h4 className="text-xs font-bold text-[#133c3e] uppercase tracking-wider border-b border-[#133c3e]/20 pb-1 mb-3">
                  Số Đo Áo/Vest (cm)
                </h4>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  <CommonField label="Dài Áo" value={customer.aoDai} />
                  <CommonField label="Vai" value={customer.vai} />
                  <CommonField label="Tay" value={customer.tay} />
                  <CommonField label="Ngực" value={customer.nguc} />
                  <CommonField label="Eo" value={customer.eo} />
                  <CommonField label="Mông" value={customer.mong} />
                  <CommonField label="Cổ" value={customer.co} />
                  <CommonField label="Hạ eo" value={customer.haEo} />
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-[#133c3e] uppercase tracking-wider border-b border-[#133c3e]/20 pb-1 mb-3">
                  Số Đo Quần/Váy (cm)
                </h4>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  <CommonField label="Dài Quần" value={customer.quanDai} />
                  <CommonField label="Eo" value={customer.eoQuan} />
                  <CommonField label="Mông" value={customer.mongQuan} />
                  <CommonField label="Đáy" value={customer.day} />
                  <CommonField label="Đùi" value={customer.dui} />
                  <CommonField label="Gối" value={customer.goi} />
                  <CommonField label="Ống" value={customer.ong} />
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-[#133c3e] uppercase tracking-wider border-b border-[#133c3e]/20 pb-1 mb-3">
                  Thanh Toán (VNĐ)
                </h4>
                <div className="grid grid-cols-3 gap-2 bg-red-50/50 p-3 rounded-xl border border-red-100">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">
                      Giá tiền
                    </span>
                    <span className="font-bold text-gray-800">
                      {formatCurrency(customer.giaTien)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">
                      Đã cọc
                    </span>
                    <span className="font-bold text-green-600">
                      {formatCurrency(customer.datTruoc)}
                    </span>
                  </div>
                  <div className="flex flex-col border-l border-red-200 pl-2">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">
                      Còn lại
                    </span>
                    <span className="font-black text-red-600">
                      {formatCurrency(customer.conLai)}
                    </span>
                  </div>
                </div>
              </div>
              {customer.notes && (
                <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100">
                  <h4 className="text-xs font-bold text-yellow-700 uppercase mb-1">
                    Ghi Chú
                  </h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {customer.notes}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveEdit();
              }}
              className="space-y-5 bg-white p-5 rounded-xl border-2 border-[#133c3e] shadow-lg"
            >
              <h3 className="font-black text-lg text-[#133c3e] border-b pb-2">
                ✏️ Chỉnh Sửa Đơn Hàng
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium">Tên Khách Hàng</label>
                  <input
                    type="text"
                    name="name"
                    value={editedCustomer.name}
                    onChange={handleEditChange}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">SĐT</label>
                  <input
                    type="tel"
                    name="phone"
                    value={editedCustomer.phone}
                    onChange={handleEditChange}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Email</label>
                  <input
                    type="email"
                    name="email"
                    value={editedCustomer.email}
                    onChange={handleEditChange}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium">Mã Vải</label>
                  <input
                    type="text"
                    name="fabricCode"
                    value={editedCustomer.fabricCode}
                    onChange={handleEditChange}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <ImageUploadInput
                    label="Đổi Ảnh Vải"
                    value={editedCustomer.fabricImageURL}
                    onChange={(base64) =>
                      setEditedCustomer({
                        ...editedCustomer,
                        fabricImageURL: base64,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium">Ngày Nhận</label>
                  <input
                    type="date"
                    name="ngayNhan"
                    value={editedCustomer.ngayNhan}
                    onChange={handleEditChange}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Ngày Giao</label>
                  <input
                    type="date"
                    name="ngayGiao"
                    value={editedCustomer.ngayGiao}
                    onChange={handleEditChange}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Trạng Thái</label>
                  <select
                    name="status"
                    value={editedCustomer.status}
                    onChange={handleEditChange}
                    className="w-full p-2 border rounded-lg"
                  >
                    <option value="Chờ xử lý">Chờ xử lý</option>
                    <option value="Đang may">Đang may</option>
                    <option value="Hoàn thành">Hoàn thành</option>
                    <option value="Đã giao">Đã giao</option>
                    <option value="Đã hủy">Đã hủy</option>
                  </select>
                </div>
              </div>
              <h4 className="text-sm font-bold text-[#133c3e] border-b pb-1 mt-4">
                Số Đo Áo/Vest
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <MeasurementInput
                  label="Dài Áo"
                  name="aoDai"
                  value={editedCustomer.aoDai}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Vai"
                  name="vai"
                  value={editedCustomer.vai}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Tay"
                  name="tay"
                  value={editedCustomer.tay}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Ngực"
                  name="nguc"
                  value={editedCustomer.nguc}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Eo"
                  name="eo"
                  value={editedCustomer.eo}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Mông"
                  name="mong"
                  value={editedCustomer.mong}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Cổ"
                  name="co"
                  value={editedCustomer.co}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Hạ eo"
                  name="haEo"
                  value={editedCustomer.haEo}
                  onChange={handleEditChange}
                />
              </div>
              <h4 className="text-sm font-bold text-[#133c3e] border-b pb-1 mt-4">
                Số Đo Quần/Váy
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <MeasurementInput
                  label="Dài Quần"
                  name="quanDai"
                  value={editedCustomer.quanDai}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Eo Quần"
                  name="eoQuan"
                  value={editedCustomer.eoQuan}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Mông Quần"
                  name="mongQuan"
                  value={editedCustomer.mongQuan}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Đáy"
                  name="day"
                  value={editedCustomer.day}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Đùi"
                  name="dui"
                  value={editedCustomer.dui}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Gối"
                  name="goi"
                  value={editedCustomer.goi}
                  onChange={handleEditChange}
                />
                <MeasurementInput
                  label="Ống"
                  name="ong"
                  value={editedCustomer.ong}
                  onChange={handleEditChange}
                />
              </div>
              <h4 className="text-sm font-bold text-red-700 border-b pb-1 mt-4">
                Thanh Toán
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <CurrencyInput
                  label="Giá tiền"
                  name="giaTien"
                  value={editedCustomer.giaTien}
                  onChange={handleEditChange}
                />
                <CurrencyInput
                  label="Đã cọc"
                  name="datTruoc"
                  value={editedCustomer.datTruoc}
                  onChange={handleEditChange}
                />
                <CurrencyInput
                  label="Còn lại"
                  name="conLai"
                  value={editedCustomer.conLai}
                  onChange={handleEditChange}
                  readOnly={true}
                />
              </div>
              <div>
                <label className="text-xs font-medium">Ghi Chú</label>
                <textarea
                  name="notes"
                  value={editedCustomer.notes}
                  onChange={handleEditChange}
                  rows="2"
                  className="w-full p-2 border rounded-lg"
                ></textarea>
              </div>
              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-3 rounded-xl text-[#e5c07b] bg-[#133c3e] hover:bg-[#0f2d2f] font-black shadow-lg transition transform hover:scale-[1.02] border border-[#e5c07b]"
              >
                {isSaving ? "Đang Lưu..." : "💾 XÁC NHẬN SỬA ĐƠN"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

// ==========================================
// MÀN HÌNH CHỦ TIỆM QUẢN LÝ
// ==========================================
const AdminDashboard = ({
  userId,
  customers,
  showToast,
  isLoading,
  handleAddCustomer,
  handleInputChange,
  newCustomer,
  setNewCustomer,
  setIsAdding,
  isAdding,
  generateFitProfile,
  isGeneratingProfile,
  generatedProfile,
  shopLogo,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("Tất cả");

  const filteredCustomers = customers.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm) ||
      (c.orderName || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = filterStatus === "Tất cả" || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const totalRevenue = filteredCustomers.reduce(
    (sum, c) => sum + Number(c.giaTien || 0),
    0
  );
  const totalUnpaid = filteredCustomers.reduce(
    (sum, c) => sum + Number(c.conLai || 0),
    0
  );

  // TÍNH NĂNG ĐỔI LOGO TRỰC TIẾP TRÊN WEB
  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast("Đang tải Logo lên máy chủ...", "success");
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        // Tự động căn giữa và cắt thành hình vuông chuẩn (500x500px)
        const size = Math.min(img.width, img.height);
        canvas.width = 500;
        canvas.height = 500;
        const ctx = canvas.getContext("2d");
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 500, 500);
        const base64 = canvas.toDataURL("image/jpeg", 0.9);

        try {
          await setDoc(
            doc(db, "public_settings", appId),
            { logo: base64 },
            { merge: true }
          );
          showToast("Cập nhật Logo thành công rực rỡ!", "success");
        } catch (err) {
          showToast("Lỗi lưu logo: " + err.message, "error");
        }
      };
    };
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row justify-between items-center bg-[#133c3e] p-6 rounded-2xl shadow-xl border-b-4 border-[#e5c07b]">
        <div className="flex items-center gap-4">
          {/* NÚT BẤM ĐỂ THAY ĐỔI LOGO */}
          <label
            className="cursor-pointer relative group block w-16 h-16 rounded-full border-2 border-[#e5c07b] shadow-md bg-white overflow-hidden flex-shrink-0"
            title="Bấm vào để đổi Logo"
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoChange}
            />
            <img
              src={shopLogo}
              alt="Logo Tiệm"
              className="w-full h-full object-cover group-hover:opacity-40 transition duration-300"
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition duration-300">
              <span className="text-white text-[10px] font-black tracking-wider text-center">
                ĐỔI
                <br />
                LOGO
              </span>
            </div>
          </label>

          <div>
            <h1 className="text-2xl font-black text-[#e5c07b] tracking-wide uppercase">
              Trung Tâm Veston Sĩ Hiền
            </h1>
            <p className="text-sm text-gray-300">Hệ Thống Quản Lý Nội Bộ</p>
          </div>
        </div>
        <div className="mt-4 sm:mt-0 flex gap-2">
          <button
            onClick={() => exportToCSV(filteredCustomers)}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition shadow-sm border border-white/20"
          >
            📊 Tải Excel
          </button>
          <button
            onClick={() => setIsAdding(!isAdding)}
            className={`px-5 py-2 text-sm font-bold rounded-lg transition border shadow-lg ${
              isAdding
                ? "bg-gray-200 text-gray-800"
                : "bg-[#e5c07b] text-[#133c3e] hover:bg-yellow-500 border-[#e5c07b]"
            }`}
          >
            {isAdding ? "Hủy" : "+ THÊM ĐƠN KHÁCH HÀNG"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-blue-100 border-l-4 border-l-blue-500">
          <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">
            Tổng Số Đơn
          </p>
          <p className="text-3xl font-black text-blue-700">
            {filteredCustomers.length}
          </p>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-green-100 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">
            Doanh thu dự kiến
          </p>
          <p className="text-3xl font-black text-green-700">
            {formatCurrency(totalRevenue)} đ
          </p>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-red-100 border-l-4 border-l-red-500">
          <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">
            Khách Đang Nợ
          </p>
          <p className="text-3xl font-black text-red-700">
            {formatCurrency(totalUnpaid)} đ
          </p>
        </div>
      </div>

      {isAdding && (
        <div className="bg-white shadow-2xl rounded-3xl p-6 md:p-8 border-2 border-[#133c3e] animate-slide-down">
          <h2 className="text-xl font-black text-[#133c3e] mb-6 flex items-center border-b pb-3 uppercase">
            📝 TẠO ĐƠN HÀNG MỚI
          </h2>
          <form onSubmit={handleAddCustomer} className="space-y-6">
            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-sm font-bold text-gray-700">
                    Tên Khách Hàng <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    name="name"
                    value={newCustomer.name}
                    onChange={handleInputChange}
                    className="mt-1 w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#133c3e] outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-gray-700">
                    SĐT Liên Hệ <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="tel"
                    name="phone"
                    value={newCustomer.phone}
                    onChange={handleInputChange}
                    className="mt-1 w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#133c3e] outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-gray-700">
                    Email Khách Hàng
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={newCustomer.email}
                    onChange={handleInputChange}
                    className="mt-1 w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#133c3e] outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-bold text-gray-700">
                    Mã Vải
                  </label>
                  <input
                    type="text"
                    name="fabricCode"
                    value={newCustomer.fabricCode}
                    onChange={handleInputChange}
                    className="mt-1 w-full p-3 border border-gray-300 rounded-xl"
                  />
                </div>
                <div className="col-span-2">
                  <ImageUploadInput
                    label="📸 Mở Camera Chụp Ảnh Vải"
                    value={newCustomer.fabricImageURL}
                    onChange={(base64) =>
                      setNewCustomer({ ...newCustomer, fabricImageURL: base64 })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-gray-50 p-5 rounded-2xl border border-gray-200">
              <div>
                <label className="text-sm font-bold text-gray-700">
                  Ngày Nhận
                </label>
                <input
                  type="date"
                  name="ngayNhan"
                  value={newCustomer.ngayNhan}
                  onChange={handleInputChange}
                  className="mt-1 w-full p-3 border border-gray-300 rounded-xl"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700">
                  Ngày Giao
                </label>
                <input
                  type="date"
                  name="ngayGiao"
                  value={newCustomer.ngayGiao}
                  onChange={handleInputChange}
                  className="mt-1 w-full p-3 border border-gray-300 rounded-xl"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700">
                  Số Lượng
                </label>
                <MeasurementInput
                  name="soLuong"
                  value={newCustomer.soLuong}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700">
                  Trạng Thái
                </label>
                <select
                  name="status"
                  value={newCustomer.status}
                  onChange={handleInputChange}
                  className="mt-1 w-full p-3 border border-gray-300 rounded-xl bg-white"
                >
                  <option value="Chờ xử lý">Chờ xử lý</option>
                  <option value="Đang may">Đang may</option>
                  <option value="Hoàn thành">Hoàn thành</option>
                  <option value="Đã giao">Đã giao</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-1 bg-blue-50/50 p-5 rounded-2xl border border-blue-100">
                <h3 className="text-sm font-black uppercase tracking-widest text-blue-800 mb-4 border-b pb-2">
                  Số Đo Áo / Vest
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <MeasurementInput
                    label="Dài Áo"
                    name="aoDai"
                    value={newCustomer.aoDai}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Vai"
                    name="vai"
                    value={newCustomer.vai}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Tay"
                    name="tay"
                    value={newCustomer.tay}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Ngực"
                    name="nguc"
                    value={newCustomer.nguc}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Eo"
                    name="eo"
                    value={newCustomer.eo}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Mông"
                    name="mong"
                    value={newCustomer.mong}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Cổ"
                    name="co"
                    value={newCustomer.co}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Hạ eo"
                    name="haEo"
                    value={newCustomer.haEo}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
              <div className="flex-1 bg-yellow-50/50 p-5 rounded-2xl border border-yellow-100">
                <h3 className="text-sm font-black uppercase tracking-widest text-yellow-800 mb-4 border-b pb-2">
                  Số Đo Quần / Váy
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <MeasurementInput
                    label="Dài Quần"
                    name="quanDai"
                    value={newCustomer.quanDai}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Eo"
                    name="eoQuan"
                    value={newCustomer.eoQuan}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Mông"
                    name="mongQuan"
                    value={newCustomer.mongQuan}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Đáy"
                    name="day"
                    value={newCustomer.day}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Đùi"
                    name="dui"
                    value={newCustomer.dui}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Gối"
                    name="goi"
                    value={newCustomer.goi}
                    onChange={handleInputChange}
                  />
                  <MeasurementInput
                    label="Ống"
                    name="ong"
                    value={newCustomer.ong}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-pink-50 to-purple-50 p-5 rounded-2xl border border-pink-100">
              <button
                type="button"
                onClick={generateFitProfile}
                disabled={isGeneratingProfile}
                className={`w-full py-3 px-4 rounded-xl text-white font-bold shadow-md transition ${
                  isGeneratingProfile
                    ? "bg-pink-300"
                    : "bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
                }`}
              >
                {isGeneratingProfile
                  ? "⏳ AI đang suy nghĩ..."
                  : "✨ Bấm Nhờ AI Phân Tích Vóc Dáng Lên Đồ"}
              </button>
              {generatedProfile && (
                <div className="mt-4 p-4 bg-white rounded-xl shadow-sm text-sm text-gray-700 border border-pink-100 leading-relaxed font-semibold whitespace-pre-line">
                  {generatedProfile}
                </div>
              )}
            </div>

            <div className="bg-red-50/50 p-5 rounded-2xl border border-red-100">
              <h3 className="text-sm font-black uppercase tracking-widest text-red-800 mb-4 border-b pb-2">
                Thanh Toán
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <CurrencyInput
                  label="Giá tiền"
                  name="giaTien"
                  value={newCustomer.giaTien}
                  onChange={handleInputChange}
                />
                <CurrencyInput
                  label="Đã cọc"
                  name="datTruoc"
                  value={newCustomer.datTruoc}
                  onChange={handleInputChange}
                />
                <CurrencyInput
                  label="Còn lại"
                  name="conLai"
                  value={newCustomer.conLai}
                  onChange={handleInputChange}
                  readOnly={true}
                />
              </div>
            </div>

            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
              <label className="text-sm font-bold text-gray-700 mb-2 block">
                Ghi Chú Đặc Biệt
              </label>
              <textarea
                name="notes"
                value={newCustomer.notes}
                onChange={handleInputChange}
                rows="2"
                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#133c3e] outline-none"
              ></textarea>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 rounded-2xl text-[#e5c07b] bg-gradient-to-r from-[#133c3e] to-[#1a4f52] hover:from-[#0f2d2f] hover:to-[#133c3e] font-black text-xl shadow-xl shadow-[#133c3e]/30 transition transform hover:-translate-y-1 border-2 border-[#e5c07b]"
            >
              {isLoading ? "ĐANG LƯU..." : "💾 LƯU ĐƠN HÀNG MỚI"}
            </button>
          </form>
        </div>
      )}

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 sticky top-2 z-10 flex flex-col sm:flex-row gap-4">
        <input
          type="text"
          placeholder="🔍 Tìm kiếm Tên, SĐT, Mã đơn của khách..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 p-3 border-2 border-gray-200 rounded-xl bg-gray-50 outline-none focus:border-[#133c3e] focus:bg-white transition font-semibold"
        />
        <div className="flex overflow-x-auto gap-2 pb-2 sm:pb-0 scrollbar-hide items-center">
          {["Tất cả", "Chờ xử lý", "Đang may", "Hoàn thành", "Đã giao"].map(
            (status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition ${
                  filterStatus === status
                    ? "bg-[#133c3e] text-[#e5c07b] shadow-md border border-[#e5c07b]"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {status}
              </button>
            )
          )}
        </div>
      </div>

      <div className="pb-20">
        {isLoading && customers.length === 0 && (
          <div className="text-center p-10 font-bold text-gray-400">
            Đang tải dữ liệu từ máy chủ...
          </div>
        )}
        {!isLoading && filteredCustomers.length === 0 && !isAdding && (
          <div className="text-center p-16 bg-white rounded-3xl border border-dashed border-gray-300">
            <p className="text-5xl mb-4">🪡</p>
            <p className="text-gray-500 font-medium">Chưa có đơn hàng nào!</p>
          </div>
        )}
        {filteredCustomers.map((c) => (
          <CustomerCard
            key={c.id}
            customer={c}
            ownerId={userId}
            appId={appId}
            db={db}
            showToast={showToast}
            role="admin"
          />
        ))}
      </div>
    </div>
  );
};

// ==========================================
// MÀN HÌNH KHÁCH HÀNG TRA CỨU
// ==========================================
const CustomerLookup = ({ ownerId, showToast, shopLogo }) => {
  const [lookupInfo, setLookupInfo] = useState({ phone: "", orderName: "" });
  const [orderResult, setOrderResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const searchOrder = async (e) => {
    e.preventDefault();
    setOrderResult(null);
    if (!lookupInfo.phone || !lookupInfo.orderName)
      return showToast("Vui lòng nhập đủ SĐT và Mã đơn hàng.", "error");
    setLookupLoading(true);
    try {
      const q = query(
        collection(
          db,
          `artifacts/${appId}/users/${ownerId}/customer_measurements`
        ),
        where("phone", "==", lookupInfo.phone.trim()),
        where("orderName", "==", lookupInfo.orderName.trim().toUpperCase())
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        setOrderResult({ id: snap.docs[0].id, ...snap.docs[0].data() });
        showToast("Tìm thấy đơn hàng!", "success");
      } else
        showToast("Không tìm thấy. Hãy kiểm tra lại SĐT và Mã đơn.", "error");
    } catch (e) {
      showToast("Lỗi hệ thống: " + e.message, "error");
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10">
      <div className="bg-white shadow-2xl shadow-green-100 rounded-3xl p-8 border border-green-200">
        <div className="flex justify-center mb-6">
          <img
            src={shopLogo}
            alt="Logo"
            className="w-20 h-20 rounded-full border-4 border-green-200 shadow-md object-cover"
          />
        </div>
        <h1 className="text-3xl font-black text-green-700 text-center mb-2 uppercase">
          TRA CỨU ĐƠN KHÁCH HÀNG
        </h1>
        <p className="text-center text-gray-500 text-sm mb-8 font-medium">
          Nhập đúng thông tin để xem tiến độ may đồ của bạn
        </p>
        <form onSubmit={searchOrder} className="space-y-5">
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">
              Số Điện Thoại Đặt May
            </label>
            <input
              type="tel"
              value={lookupInfo.phone}
              onChange={(e) =>
                setLookupInfo({ ...lookupInfo, phone: e.target.value })
              }
              className="mt-1 w-full p-4 bg-gray-50 border border-gray-300 rounded-xl focus:border-green-500 focus:bg-white outline-none transition font-bold text-lg"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">
              Mã Đơn Hàng Bí Mật
            </label>
            <input
              type="text"
              value={lookupInfo.orderName}
              onChange={(e) =>
                setLookupInfo({ ...lookupInfo, orderName: e.target.value })
              }
              className="mt-1 w-full p-4 bg-gray-50 border border-gray-300 rounded-xl focus:border-green-500 focus:bg-white outline-none transition font-mono font-bold text-lg"
              placeholder="VD: NGUYENVANA_123"
            />
          </div>
          <button
            type="submit"
            disabled={lookupLoading}
            className="w-full py-4 font-black text-lg rounded-xl text-white bg-green-600 hover:bg-green-700 shadow-xl shadow-green-200 transition transform hover:-translate-y-1 mt-4"
          >
            {lookupLoading ? "ĐANG TÌM..." : "KIỂM TRA TIẾN ĐỘ NGAY"}
          </button>
        </form>
      </div>
      {orderResult && (
        <div className="mt-8 animate-slide-down">
          <CustomerCard
            customer={orderResult}
            ownerId={ownerId}
            appId={appId}
            db={db}
            showToast={showToast}
            role="guest"
          />
        </div>
      )}
    </div>
  );
};

// ==========================================
// MÀN HÌNH ĐĂNG NHẬP CHÍNH THỨC
// ==========================================
const LoginScreen = ({ setAppRole, OWNER_ID, showToast, shopLogo }) => {
  const [pin, setPin] = useState("");
  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (pin === ADMIN_PASSCODE && OWNER_ID) {
      setAppRole("admin");
      localStorage.setItem("appRole", "admin");
    } else showToast("Sai Mã PIN bảo mật!", "error");
  };
  return (
    <div className="max-w-md w-full mx-auto mt-16 p-6 sm:p-10 bg-white shadow-2xl rounded-[2rem] border border-gray-200">
      {/* LOGO HIỂN THỊ TRỰC TIẾP TỪ FIREBASE */}
      <div className="text-center mb-10">
        <img
          src={shopLogo}
          alt="Logo Veston Sĩ Hiền"
          className="w-32 h-32 mx-auto mb-6 rounded-full shadow-2xl border-4 border-[#e5c07b] object-cover bg-white"
        />
        <h1 className="text-3xl font-black text-[#133c3e] tracking-tight uppercase">
          Trung Tâm Veston
        </h1>
        <h1 className="text-4xl font-black text-[#e5c07b] mt-1 drop-shadow-sm uppercase">
          SĨ HIỀN
        </h1>
        <p className="text-gray-500 font-bold mt-2 text-sm tracking-widest">
          EST. 2004
        </p>
      </div>

      <div className="space-y-8">
        <div className="p-1 rounded-2xl bg-gradient-to-r from-green-400 to-emerald-500 p-[2px]">
          <div className="bg-white rounded-2xl p-4">
            <h3 className="font-black text-green-700 mb-2 text-center text-sm uppercase">
              🚪 DÀNH CHO KHÁCH HÀNG
            </h3>
            <p className="text-xs text-center text-gray-500 mb-4">
              Xem tiến độ may trang phục của bạn
            </p>
            <button
              onClick={() => setAppRole("guest")}
              className="w-full py-4 font-black text-lg rounded-xl bg-green-50 text-green-700 border-2 border-green-200 hover:bg-green-100 hover:border-green-300 transition shadow-sm"
            >
              TRA CỨU ĐƠN HÀNG
            </button>
          </div>
        </div>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-gray-300"></div>
          <span className="flex-shrink-0 mx-4 text-gray-400 text-xs font-black uppercase tracking-widest">
            Khu Vực Nội Bộ
          </span>
          <div className="flex-grow border-t border-gray-300"></div>
        </div>

        <div className="p-5 rounded-2xl bg-[#133c3e] border-2 border-[#e5c07b] shadow-xl relative overflow-hidden">
          <h3 className="font-black text-[#e5c07b] mb-4 text-center text-sm uppercase tracking-wider">
            🔒 ĐĂNG NHẬP QUẢN LÝ TIỆM
          </h3>
          <form onSubmit={handleAdminLogin} className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Nhập mã PIN bảo mật"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full p-4 bg-white/10 border-2 border-[#e5c07b]/50 text-white rounded-xl text-center tracking-[0.5em] font-bold outline-none focus:border-[#e5c07b] focus:bg-white/20 placeholder-gray-400 transition"
              maxLength={4}
            />
            <button
              type="submit"
              className="w-full py-4 font-black text-lg rounded-xl bg-[#e5c07b] text-[#133c3e] hover:bg-yellow-500 transition shadow-lg mt-2 uppercase"
            >
              VÀO LÀM VIỆC
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    fabricCode: "",
    fabricImageURL: "",
    ngayNhan: "",
    ngayGiao: "",
    soLuong: "1",
    aoDai: "",
    vai: "",
    tay: "",
    nguc: "",
    eo: "",
    mong: "",
    co: "",
    haBen: "",
    haEo: "",
    quanDai: "",
    mongQuan: "",
    day: "",
    dui: "",
    goi: "",
    ong: "",
    eoQuan: "",
    giaTien: "",
    datTruoc: "",
    conLai: "",
    status: "Chờ xử lý",
    notes: "",
  });
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [appRole, setAppRole] = useState(null);
  const [toast, setToast] = useState(null);
  const [isGeneratingProfile, setIsGeneratingProfile] = useState(false);
  const [generatedProfile, setGeneratedProfile] = useState(null);

  // STATE LƯU TRỮ LOGO
  const [shopLogo, setShopLogo] = useState(
    "https://i.postimg.cc/JhTTtmTt/LOGO.jpg"
  );

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    const initFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Lắng nghe và tải Logo từ máy chủ (Cập nhật mọi nơi ngay lập tức)
        onSnapshot(doc(db, "public_settings", appId), (docSnap) => {
          if (docSnap.exists() && docSnap.data().logo) {
            setShopLogo(docSnap.data().logo);
          }
        });

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (user) {
            OWNER_ID = user.uid;
            if (localStorage.getItem("appRole") === "admin")
              setAppRole("admin");
            setIsLoading(false);
          } else await signInAnonymously(auth);
        });
        return () => unsubscribe();
      } catch (e) {
        showToast("Lỗi hệ thống.", "error");
        setIsLoading(false);
      }
    };
    initFirebase();
  }, [showToast]);

  useEffect(() => {
    if (appRole !== "admin" || !OWNER_ID || !db) return;
    const q = collection(
      db,
      `artifacts/${appId}/users/${OWNER_ID}/customer_measurements`
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      setCustomers(list);
    });
    return () => unsubscribe();
  }, [appRole]);

  const generateFitProfile = async () => {
    const measurements = {
      "Dài Áo": newCustomer.aoDai,
      Vai: newCustomer.vai,
      Ngực: newCustomer.nguc,
      Eo: newCustomer.eo,
      Mông: newCustomer.mong,
      "Dài Quần": newCustomer.quanDai,
    };
    const promptDetails = Object.entries(measurements)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}cm`)
      .join(", ");
    if (!promptDetails)
      return showToast(
        "Vui lòng nhập vài số đo để AI có dữ liệu phân tích nhé.",
        "error"
      );

    setIsGeneratingProfile(true);
    try {
      const apiKey = "AIzaSyAIFjr0Ahe7xoonjseOSE4IALeBjvvfEzs";
      if (!apiKey) {
        setGeneratedProfile("Lỗi: Chưa có API Key.");
        setIsGeneratingProfile(false);
        return;
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Là một chuyên gia thiết kế thời trang và thợ may bậc thầy. Dựa trên số đo (cm) của khách: ${promptDetails}. Hãy làm 3 việc: 1. Nhận xét nhanh ưu/khuyết điểm vóc dáng. 2. Tư vấn kiểu dáng quần áo phù hợp nhất. 3. Đưa ra 1 lưu ý kỹ thuật khi cắt may. Trả lời chuyên nghiệp bằng gạch đầu dòng.`,
                  },
                ],
              },
            ],
            safetySettings: [
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE",
              },
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE",
              },
            ],
          }),
        }
      );
      const data = await res.json();
      if (!res.ok)
        setGeneratedProfile(
          `Lỗi từ AI: ${data.error?.message || "Không rõ nguyên nhân"}`
        );
      else if (data.candidates && data.candidates[0]?.finishReason === "SAFETY")
        setGeneratedProfile(
          "Google chặn do từ khóa nhạy cảm. Bạn hãy thử bỏ trống ô Ngực/Mông rồi bấm lại nhé."
        );
      else
        setGeneratedProfile(
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
            "Không có kết quả phân tích."
        );
    } catch (e) {
      setGeneratedProfile(`Lỗi mạng/kết nối: ${e.message}`);
    }
    setIsGeneratingProfile(false);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const isNumeric = [
      "aoDai",
      "vai",
      "tay",
      "nguc",
      "eo",
      "mong",
      "co",
      "haBen",
      "haEo",
      "quanDai",
      "mongQuan",
      "day",
      "dui",
      "goi",
      "ong",
      "eoQuan",
      "soLuong",
      "giaTien",
      "datTruoc",
    ].includes(name);
    const finalValue = isNumeric ? value.replace(/\D/g, "") : value;
    setNewCustomer((prev) => {
      const updated = { ...prev, [name]: finalValue };
      if (name === "giaTien" || name === "datTruoc") {
        const total = parseInt(updated.giaTien || "0");
        const deposit = parseInt(updated.datTruoc || "0");
        updated.conLai = (total > deposit ? total - deposit : 0).toString();
      }
      return updated;
    });
  };

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    if (!newCustomer.name || !newCustomer.phone)
      return showToast("Tên và SĐT là bắt buộc.", "error");
    const orderName = generateOrderName(newCustomer.name, newCustomer.phone);
    try {
      setIsLoading(true);
      await addDoc(
        collection(
          db,
          `artifacts/${appId}/users/${OWNER_ID}/customer_measurements`
        ),
        {
          ...newCustomer,
          orderName,
          generatedProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      showToast(`Lưu thành công! Mã đơn: ${orderName}`, "success");
      setNewCustomer({
        name: "",
        phone: "",
        email: "",
        fabricCode: "",
        fabricImageURL: "",
        ngayNhan: "",
        ngayGiao: "",
        soLuong: "1",
        aoDai: "",
        vai: "",
        tay: "",
        nguc: "",
        eo: "",
        mong: "",
        co: "",
        haBen: "",
        haEo: "",
        quanDai: "",
        mongQuan: "",
        day: "",
        dui: "",
        goi: "",
        ong: "",
        eoQuan: "",
        giaTien: "",
        datTruoc: "",
        conLai: "",
        status: "Chờ xử lý",
        notes: "",
      });
      setGeneratedProfile(null);
      setIsAdding(false);
    } catch (e) {
      showToast("Lỗi khi lưu: " + e.message, "error");
    }
    setIsLoading(false);
  };

  if (isLoading && OWNER_ID === null)
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#133c3e] border-t-[#e5c07b] rounded-full animate-spin"></div>
      </div>
    );
  if (appRole === null)
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center pb-10">
        <LoginScreen
          setAppRole={setAppRole}
          OWNER_ID={OWNER_ID}
          showToast={showToast}
          shopLogo={shopLogo}
        />
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-10 text-gray-800 relative overflow-hidden">
      {toast && (
        <div
          className={`fixed top-5 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl text-white font-bold text-sm z-50 transition-all ${
            toast.type === "success" ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="bg-[#0a1f20] px-4 py-3 flex justify-between items-center shadow-md">
        <div className="text-[#e5c07b] font-bold text-sm flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>{" "}
          {appRole === "admin"
            ? "Quyền Chủ Tiệm (Admin)"
            : "Chế Độ Khách Hàng (Chỉ Xem)"}
        </div>
        <button
          onClick={() => {
            setAppRole(null);
            setCustomers([]);
            localStorage.removeItem("appRole");
          }}
          className="text-xs text-gray-300 hover:text-white bg-white/10 px-4 py-2 rounded-lg transition border border-white/20 font-bold"
        >
          Thoát
        </button>
      </div>

      <div className="max-w-6xl mx-auto mt-6 px-4">
        {appRole === "admin" ? (
          <AdminDashboard
            userId={OWNER_ID}
            customers={customers}
            showToast={showToast}
            isLoading={isLoading}
            handleAddCustomer={handleAddCustomer}
            handleInputChange={handleInputChange}
            newCustomer={newCustomer}
            setNewCustomer={setNewCustomer}
            setIsAdding={setIsAdding}
            isAdding={isAdding}
            generateFitProfile={generateFitProfile}
            isGeneratingProfile={isGeneratingProfile}
            generatedProfile={generatedProfile}
            shopLogo={shopLogo}
          />
        ) : (
          <CustomerLookup
            ownerId={OWNER_ID}
            showToast={showToast}
            shopLogo={shopLogo}
          />
        )}
      </div>
    </div>
  );
}
