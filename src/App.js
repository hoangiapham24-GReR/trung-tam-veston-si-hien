import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, serverTimestamp, doc, deleteDoc, setDoc, where, getDocs } from 'firebase/firestore';

// CẤU HÌNH FIREBASE CỦA TIỆM
const appId = 'tiem-may-veston-si-hien';
const firebaseConfig = {
  apiKey: "AIzaSyDuB85lWrkVb0DAnTyxIp6sUERdbWcQAow",
  authDomain: "trung-tam-veston-si-hien.firebaseapp.com",
  projectId: "trung-tam-veston-si-hien",
  storageBucket: "trung-tam-veston-si-hien.firebasestorage.app",
  messagingSenderId: "136164117027",
  appId: "1:136164117027:web:6f47ce84ab91d4ceb3bf96"
};

// 🔒 MÃ PIN BÍ MẬT DÀNH RIÊNG CHO CHỦ TIỆM
const ADMIN_PASSCODE = '2004'; 
let db; let auth; let OWNER_ID = null; 

const formatCurrency = (amount) => {
    const numericAmount = String(amount || '0').replace(/\D/g, '');
    if (!numericAmount) return '0';
    return Number(numericAmount).toLocaleString('vi-VN');
};

const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
        if (dateString.toDate) return dateString.toDate().toLocaleDateString('vi-VN');
        const dateObj = new Date(dateString);
        return dateObj.toLocaleDateString('vi-VN');
    } catch (e) {
        return dateString || '—';
    }
};

const getStatusColor = (status) => {
    switch (status) {
        case 'Đang may': return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
        case 'Hoàn thành': return 'bg-green-100 text-green-700 border border-green-200';
        case 'Đã giao': return 'bg-blue-100 text-blue-700 border border-blue-200';
        case 'Chờ xử lý': return 'bg-gray-100 text-gray-700 border border-gray-200';
        default: return 'bg-red-100 text-red-700 border border-red-200';
    }
};

const generateOrderName = (name, phone) => {
    if (!name || !phone) return null;
    const sanitizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '').toUpperCase();
    const phoneDigits = phone.replace(/\D/g, ''); 
    const lastThreeDigits = phoneDigits.slice(-3);
    return `${sanitizedName.substring(0, 15)}_${lastThreeDigits}`;
};

// ==========================================
// 🚀 TÍNH NĂNG GỬI EMAIL TỰ ĐỘNG (GỬI HÓA ĐƠN)
// ==========================================
const sendEmailInvoice = async (customer, showToast) => {
    if (!customer.email) {
        showToast("Khách hàng này chưa có thông tin Email. Bấm 'Sửa Đơn' để thêm email nhé!", "error");
        return;
    }
    showToast("Đang gửi email tự động...", "success");
    const EMAILJS_SERVICE_ID = "service_r1rgdnp"; 
    const EMAILJS_TEMPLATE_ID = "template_2ypt4fw"; 
    const EMAILJS_PUBLIC_KEY = "gq1x0nWZpwbsYajd0"; 

    try {
        const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                service_id: EMAILJS_SERVICE_ID, template_id: EMAILJS_TEMPLATE_ID, user_id: EMAILJS_PUBLIC_KEY,
                template_params: {
                    to_name: customer.name, to_email: customer.email, order_id: customer.orderName,
                    phone: customer.phone, receive_date: formatDate(customer.ngayNhan), delivery_date: formatDate(customer.ngayGiao),
                    status: customer.status, total_price: formatCurrency(customer.giaTien), deposit: formatCurrency(customer.datTruoc), remaining: formatCurrency(customer.conLai)
                }
            })
        });
        if (response.ok) showToast("Đã gửi Hóa Đơn thành công đến email khách hàng!", "success");
        else showToast("Lỗi gửi mail: " + await response.text(), "error");
    } catch (error) { showToast("Không thể kết nối đến máy chủ gửi Mail.", "error"); }
};

const exportToCSV = (customers) => {
    const headers = ['Tên KH', 'SĐT', 'Email', 'Mã Vải', 'Ngày Nhận', 'Ngày Giao', 'Số Lượng', 'Trạng Thái', 'Giá Tiền', 'Đặt Trước', 'Còn Lại', 'Tên Đơn Hàng', 'Ghi Chú', 'Phân Tích AI'];
    const rows = customers.map(c => [
        `"${c.name || ''}"`, `"${c.phone || ''}"`, `"${c.email || ''}"`, `"${c.fabricCode || ''}"`, 
        `"${c.ngayNhan || ''}"`, `"${c.ngayGiao || ''}"`, `"${c.soLuong || ''}"`, `"${c.status || ''}"`, 
        `"${c.giaTien || '0'}"`, `"${c.datTruoc || '0'}"`, `"${c.conLai || '0'}"`, `"${c.orderName || ''}"`,
        `"${(c.notes || '').replace(/\n/g, ' ')}"`, `"${(c.generatedProfile || '').replace(/\n/g, ' ')}"`
    ]);
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `danh_sach_don_hang_${new Date().getTime()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
};

const MeasurementInput = ({ label, name, value, onChange }) => (
    <div className="flex flex-col">
        <label className="text-xs font-medium text-gray-700 mb-1">{label}</label>
        <input type="text" inputMode="numeric" name={name} value={value || ''} onChange={(e) => onChange({ target: { name, value: e.target.value.replace(/\D/g, '') } })} className="p-2 border rounded-lg bg-white border-gray-300 focus:ring-2 focus:ring-[#133c3e] outline-none transition" placeholder="cm" />
    </div>
);

const CurrencyInput = ({ label, name, value, onChange, readOnly = false }) => (
    <div className="flex flex-col">
        <label className="text-xs font-medium text-gray-700 mb-1">{label} (VNĐ)</label>
        <input type="text" inputMode="numeric" name={name} value={formatCurrency(value)} onChange={(e) => onChange({ target: { name, value: e.target.value.replace(/\D/g, '') } })} readOnly={readOnly} className={`p-2 border rounded-lg outline-none transition ${readOnly ? 'bg-gray-100 text-gray-500 font-bold' : 'bg-white border-gray-300 focus:ring-2 focus:ring-red-400 font-bold'}`} placeholder="0" />
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
            const img = new Image(); img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 500; const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH; canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                onChange(canvas.toDataURL('image/jpeg', 0.7)); setIsUploading(false);
            };
        };
    };
    return (
        <div className="flex flex-col col-span-2 sm:col-span-2">
            <label className="text-xs font-medium text-gray-700 mb-1">{label}</label>
            {value ? (
                <div className="relative mb-2">
                    <img src={value} alt="Mẫu vải" className="w-full h-40 object-cover rounded-lg border border-gray-300 shadow-sm" />
                    <button type="button" onClick={() => onChange('')} className="absolute top-2 right-2 bg-red-500 text-white rounded-full px-3 py-1 text-xs font-bold shadow-md hover:bg-red-600 transition">X Xóa ảnh</button>
                </div>
            ) : (
                <input type="file" accept="image/*" onChange={handleFileChange} className="p-2 border rounded-lg bg-white border-gray-300 text-sm focus:ring-[#133c3e] focus:border-[#133c3e] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-[#133c3e]/10 file:text-[#133c3e] hover:file:bg-[#133c3e]/20 cursor-pointer" />
            )}
            {isUploading && <span className="text-xs text-[#133c3e] mt-1 animate-pulse">Đang nén ảnh...</span>}
        </div>
    );
};

// ==========================================
// 🎨 BỘ CÔNG CỤ CẮT & CĂN CHỈNH ẢNH
// ==========================================
const SimpleCropper = ({ imageSrc, onSave, onCancel }) => {
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });

    const CONTAINER_SIZE = 300; 

    const onPointerDown = (e) => {
        setIsDragging(true);
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        setStartPos({ x: clientX - position.x, y: clientY - position.y });
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        setPosition({ x: clientX - startPos.x, y: clientY - startPos.y });
    };

    const onPointerUp = () => setIsDragging(false);

    const applyCrop = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 500; canvas.height = 500;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = imageSrc;
        img.onload = () => {
            ctx.clearRect(0, 0, 500, 500);

            const ratio = 500 / CONTAINER_SIZE; 
            const maxDim = Math.max(img.width, img.height);
            const baseScale = CONTAINER_SIZE / maxDim;
            const drawScale = baseScale * zoom * ratio;

            const w = img.width * drawScale;
            const h = img.height * drawScale;
            const x = 250 - (w / 2) + (position.x * ratio);
            const y = 250 - (h / 2) + (position.y * ratio);

            ctx.drawImage(img, x, y, w, h);
            onSave(canvas.toDataURL('image/png'));
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 animate-fade-in backdrop-blur-sm">
            <div className="bg-white p-6 rounded-[2rem] w-full max-w-sm flex flex-col items-center shadow-2xl">
                <h3 className="font-black text-2xl mb-6 text-[#133c3e] uppercase tracking-wide border-b-2 border-[#e5c07b] pb-2">Căn Chỉnh Logo</h3>
                
                <div 
                    className="relative w-[300px] h-[300px] overflow-hidden rounded-full border-4 border-[#e5c07b] bg-gray-50 cursor-move shadow-[inset_0_0_20px_rgba(0,0,0,0.1)]"
                    onMouseDown={onPointerDown} onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
                    onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
                >
                    <img src={imageSrc} alt="Preview" draggable="false"
                         style={{
                             transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
                             position: 'absolute', top: '50%', left: '50%',
                             maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto',
                             pointerEvents: 'none'
                         }}
                    />
                    <div className="absolute inset-0 pointer-events-none border-[15px] border-white/20 rounded-full"></div>
                </div>

                <div className="w-full mt-8 flex items-center gap-4 px-2">
                    <span className="text-2xl opacity-60">🔍</span>
                    <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(e.target.value)} className="flex-1 h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#e5c07b]" />
                    <span className="text-3xl">🔍</span>
                </div>
                
                <p className="text-xs text-gray-500 mt-4 mb-8 font-bold uppercase tracking-wider bg-gray-100 px-4 py-2 rounded-full">👆 Kéo thả để căn chỉnh ảnh</p>
                
                <div className="flex gap-4 w-full mt-2">
                    <button onClick={onCancel} className="flex-1 py-4 bg-gray-100 text-gray-600 font-black rounded-2xl hover:bg-gray-200 transition">HỦY</button>
                    <button onClick={applyCrop} className="flex-[2] py-4 bg-[#133c3e] text-[#e5c07b] font-black rounded-2xl hover:bg-[#0f2d2f] border border-[#e5c07b] transition shadow-lg shadow-[#133c3e]/30">LƯU AVATAR</button>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// 💌 BẢNG CHỌN GỬI TIN NHẮN (ZALO / SMS / EMAIL THÔNG MINH)
// ==========================================
const NotificationModal = ({ customer, onClose, showToast }) => {
    const [msgType, setMsgType] = useState('done'); // 'done' hoặc 'delay'
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (msgType === 'done') {
            setMessage(`Dạ chào ${customer.name}, tiệm Veston Sĩ Hiền xin thông báo đơn hàng [Mã: ${customer.orderName}] của quý khách đã hoàn thiện.\n\nTổng tiền còn nợ: ${formatCurrency(customer.conLai)} VNĐ.\n\nMời quý khách ghé tiệm thử và nhận đồ nhé. Cảm ơn quý khách!`);
        } else {
            setMessage(`Dạ chào ${customer.name}, tiệm Veston Sĩ Hiền thành thật xin lỗi quý khách vì sự cố ngoài ý muốn nên đơn hàng [Mã: ${customer.orderName}] sẽ bị trễ hẹn so với dự kiến.\n\nTiệm đang gấp rút hoàn thiện và sẽ báo lại quý khách sớm nhất. Rất mong quý khách thông cảm!`);
        }
    }, [msgType, customer]);

    const handleSendSMS = () => {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const separator = isIOS ? '&' : '?';
        window.location.href = `sms:${customer.phone}${separator}body=${encodeURIComponent(message)}`;
    };

    const handleSendZalo = () => {
        navigator.clipboard.writeText(message).then(() => {
            showToast("Đã copy tin nhắn! Đang mở Zalo...", "success");
            let phoneStr = customer.phone.replace(/\D/g, '');
            if (phoneStr.startsWith('0')) phoneStr = '84' + phoneStr.slice(1);
            window.open(`https://zalo.me/${phoneStr}`, '_blank');
        }).catch(() => {
            showToast("Không thể copy tự động. Vui lòng copy thủ công.", "error");
        });
    };

    const handleSendEmail = () => {
        if (!customer.email) {
            showToast("Khách hàng này chưa lưu Email!", "error");
            return;
        }
        const subject = msgType === 'done' ? `[Veston Sĩ Hiền] Thông báo hoàn thiện đơn hàng ${customer.orderName}` : `[Veston Sĩ Hiền] Cập nhật tiến độ đơn hàng ${customer.orderName}`;
        
        // MẮT THẦN: Kiểm tra xem đang xài Điện thoại hay Máy tính
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile) {
            // Mở app Mail mặc định trên Điện thoại
            window.location.href = `mailto:${customer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
        } else {
            // Mở tab Gmail trên Máy tính bàn / Laptop
            const gmailWebUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${customer.email}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
            window.open(gmailWebUrl, '_blank');
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-fade-in backdrop-blur-sm">
            <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 className="font-black text-lg text-[#133c3e] flex items-center gap-2">🔔 Gửi Thông Báo Khách Hàng</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500 font-bold text-xl transition">✕</button>
                </div>
                
                <div className="flex gap-2 mb-4 bg-gray-100 p-1 rounded-xl">
                    <button onClick={() => setMsgType('done')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition ${msgType === 'done' ? 'bg-green-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-200'}`}>✅ Đã may xong</button>
                    <button onClick={() => setMsgType('delay')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition ${msgType === 'delay' ? 'bg-orange-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-200'}`}>⚠️ Trễ hẹn</button>
                </div>

                <div className="mb-4">
                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase tracking-wider">Nội dung tin nhắn (Có thể sửa)</label>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="w-full h-36 p-3 bg-blue-50/50 border border-blue-200 rounded-xl text-sm text-gray-800 focus:ring-2 focus:ring-blue-400 outline-none leading-relaxed resize-none"></textarea>
                </div>

                <div className="space-y-2">
                    <button onClick={handleSendZalo} className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl shadow-md transition flex justify-center items-center gap-2">
                        <span className="text-lg">💬</span> Gửi qua Zalo (Khuyên dùng)
                    </button>
                    <div className="flex gap-2">
                        <button onClick={handleSendSMS} className="flex-1 py-3 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-bold rounded-xl shadow-sm transition flex justify-center items-center gap-2">
                            📱 Gửi SMS
                        </button>
                        <button onClick={handleSendEmail} className="flex-1 py-3 bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 font-bold rounded-xl shadow-sm transition flex justify-center items-center gap-2">
                            ✉️ Gửi Email
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// BẢN HIỂN THỊ ĐƠN HÀNG
const CustomerCard = ({ customer, ownerId, appId, db, showToast, role }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isNotifying, setIsNotifying] = useState(false); // Trạng thái mở bảng nhắn tin
    const [editedCustomer, setEditedCustomer] = useState({ ...customer });
    const [isSaving, setIsSaving] = useState(false);
    const isAdmin = role === 'admin'; 

    const handleEditChange = (e) => {
        const { name, value } = e.target;
        const isNumeric = ['aoDai', 'vai', 'tay', 'nguc', 'eo', 'mong', 'co', 'haBen', 'haEo', 'quanDai', 'mongQuan', 'day', 'dui', 'goi', 'ong', 'eoQuan', 'soLuong'].includes(name);
        const finalValue = isNumeric ? value.replace(/\D/g, '') : value;
        setEditedCustomer(prev => {
            const updated = { ...prev, [name]: finalValue };
            if (name === 'giaTien' || name === 'datTruoc') {
                const total = parseInt(updated.giaTien?.replace(/\D/g, '') || '0');
                const deposit = parseInt(updated.datTruoc?.replace(/\D/g, '') || '0');
                updated.conLai = (total > deposit ? total - deposit : 0).toString();
            }
            return updated;
        });
    };

    const saveEdit = async () => {
        if (!editedCustomer.name || !editedCustomer.phone) return showToast("Tên và SĐT là bắt buộc.", "error");
        try {
            setIsSaving(true);
            await setDoc(doc(db, `artifacts/${appId}/users/${ownerId}/customer_measurements`, customer.id), {
                ...editedCustomer, name: editedCustomer.name.trim(), phone: editedCustomer.phone.trim(), updatedAt: serverTimestamp()
            }, { merge: true });
            setIsEditing(false); showToast("Đã cập nhật đơn hàng!", "success");
        } catch (e) { showToast("Lỗi cập nhật: " + e.message, "error"); }
        setIsSaving(false);
    };

    const deleteCustomer = async () => {
        if (!window.confirm(`Xóa đơn hàng ${customer.name}? Dữ liệu không thể khôi phục!`)) return;
        try { await deleteDoc(doc(db, `artifacts/${appId}/users/${ownerId}/customer_measurements`, customer.id)); showToast("Đã xóa đơn hàng!", "success"); } 
        catch (e) { showToast("Lỗi xóa: " + e.message, "error"); }
    };

    const CommonField = ({ label, value, unit = '' }) => (
        <div className="flex flex-col bg-white p-2 rounded border border-gray-100 shadow-sm">
            <span className="text-[10px] uppercase text-gray-400 font-bold">{label}</span>
            <span className="text-sm font-semibold text-gray-800">{value ? value : '—'} {value && unit}</span>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 border border-gray-200 overflow-hidden mb-4 relative">
            {/* Modal Nhắn Tin */}
            {isNotifying && <NotificationModal customer={customer} onClose={() => setIsNotifying(false)} showToast={showToast} />}

            <div className={`p-4 cursor-pointer flex justify-between items-center transition-colors ${isExpanded ? 'bg-[#133c3e]/5 border-b border-[#133c3e]/10' : 'hover:bg-gray-50'}`} onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center">
                        {customer.name} 
                        <span className={`ml-3 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${getStatusColor(customer.status)}`}>{customer.status || 'Chờ xử lý'}</span>
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">📞 {customer.phone} {customer.fabricCode && `| 🧵 Vải: ${customer.fabricCode}`}</p>
                    <p className="text-xs text-gray-400 mt-1">Mã đơn: <span className="font-mono text-[#133c3e] font-bold">{customer.orderName}</span></p>
                </div>
                <div className="flex flex-col items-end">
                    <span className="text-sm font-black text-red-600">{formatCurrency(customer.conLai)} đ</span>
                    <span className="text-[10px] text-gray-400 uppercase font-bold">Còn nợ</span>
                    <svg className={`w-5 h-5 text-gray-400 mt-2 transform transition-transform ${isExpanded ? 'rotate-180' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
            </div>

            {isExpanded && (
                <div className="p-5 bg-gray-50/50">
                    {isAdmin && (
                        <div className="flex flex-wrap justify-end gap-2 mb-5">
                            {/* NÚT BÁO KHÁCH */}
                            <button onClick={(e) => { e.stopPropagation(); setIsNotifying(true); }} className="px-4 py-2 text-sm font-bold rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition shadow-sm animate-pulse">
                                🔔 Báo Khách
                            </button>

                            <button onClick={(e) => { e.stopPropagation(); sendEmailInvoice(customer, showToast); }} className="px-4 py-2 text-sm font-bold rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 transition shadow-sm">
                                🧾 Gửi Hóa Đơn Email
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setIsEditing(!isEditing); setEditedCustomer({ ...customer }); }} className={`px-4 py-2 text-sm font-bold rounded-lg transition shadow-sm ${isEditing ? 'bg-gray-500 text-white hover:bg-gray-600' : 'bg-[#133c3e] text-[#e5c07b] hover:bg-[#0f2d2f] border border-[#e5c07b]'}`}>
                                {isEditing ? 'Hủy Sửa' : '✏️ Sửa Đơn'}
                            </button>
                            <button onClick={deleteCustomer} className="px-4 py-2 text-sm font-bold rounded-lg bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition shadow-sm">
                                🗑️ Xóa
                            </button>
                        </div>
                    )}

                    {!isEditing || !isAdmin ? (
                        <div className="space-y-5 animate-fade-in">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <CommonField label="Ngày Nhận" value={formatDate(customer.ngayNhan)} /><CommonField label="Ngày Giao" value={formatDate(customer.ngayGiao)} /><CommonField label="Email" value={customer.email} /><CommonField label="Số lượng" value={customer.soLuong} unit="bộ" />
                            </div>
                            {customer.generatedProfile && (
                                <div className="p-4 bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl border border-pink-100 shadow-sm">
                                    <h4 className="font-bold text-pink-700 text-sm mb-1 flex items-center gap-1">✨ AI Phân Tích Vóc Dáng</h4><p className="text-sm text-gray-700 whitespace-pre-wrap">{customer.generatedProfile}</p>
                                </div>
                            )}
                            {customer.fabricImageURL && (
                                <div><h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Ảnh Mẫu Vải</h4><img src={customer.fabricImageURL} alt="Vải" className="w-full sm:w-1/2 h-auto max-h-48 object-cover rounded-xl shadow-md border border-gray-200" /></div>
                            )}
                            <div>
                                <h4 className="text-xs font-bold text-[#133c3e] uppercase tracking-wider border-b border-[#133c3e]/20 pb-1 mb-3">Số Đo Áo/Vest (cm)</h4>
                                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                    <CommonField label="Dài Áo" value={customer.aoDai} /><CommonField label="Vai" value={customer.vai} /><CommonField label="Tay" value={customer.tay} /><CommonField label="Ngực" value={customer.nguc} /><CommonField label="Eo" value={customer.eo} /><CommonField label="Mông" value={customer.mong} /><CommonField label="Cổ" value={customer.co} /><CommonField label="Hạ eo" value={customer.haEo} />
                                </div>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-[#133c3e] uppercase tracking-wider border-b border-[#133c3e]/20 pb-1 mb-3">Số Đo Quần/Váy (cm)</h4>
                                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                    <CommonField label="Dài Quần" value={customer.quanDai} /><CommonField label="Eo" value={customer.eoQuan} /><CommonField label="Mông" value={customer.mongQuan} /><CommonField label="Đáy" value={customer.day} /><CommonField label="Đùi" value={customer.dui} /><CommonField label="Gối" value={customer.goi} /><CommonField label="Ống" value={customer.ong} />
                                </div>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-[#133c3e] uppercase tracking-wider border-b border-[#133c3e]/20 pb-1 mb-3">Thanh Toán (VNĐ)</h4>
                                <div className="grid grid-cols-3 gap-2 bg-red-50/50 p-3 rounded-xl border border-red-100">
                                    <div className="flex flex-col"><span className="text-[10px] text-gray-500 font-bold uppercase">Giá tiền</span><span className="font-bold text-gray-800">{formatCurrency(customer.giaTien)}</span></div>
                                    <div className="flex flex-col"><span className="text-[10px] text-gray-500 font-bold uppercase">Đã cọc</span><span className="font-bold text-green-600">{formatCurrency(customer.datTruoc)}</span></div>
                                    <div className="flex flex-col border-l border-red-200 pl-2"><span className="text-[10px] text-gray-500 font-bold uppercase">Còn lại</span><span className="font-black text-red-600">{formatCurrency(customer.conLai)}</span></div>
                                </div>
                            </div>
                            {customer.notes && (
                                <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100"><h4 className="text-xs font-bold text-yellow-700 uppercase mb-1">Ghi Chú</h4><p className="text-sm text-gray-700 whitespace-pre-wrap">{customer.notes}</p></div>
                            )}
                        </div>
                    ) : (
                        <form onSubmit={(e) => { e.preventDefault(); saveEdit(); }} className="space-y-5 bg-white p-5 rounded-xl border-2 border-[#133c3e] shadow-lg">
                            <h3 className="font-black text-lg text-[#133c3e] border-b pb-2">✏️ Chỉnh Sửa Đơn Hàng</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div><label className="text-xs font-medium">Tên Khách Hàng</label><input type="text" name="name" value={editedCustomer.name} onChange={handleEditChange} className="w-full p-2 border rounded-lg" /></div>
                                <div><label className="text-xs font-medium">SĐT</label><input type="tel" name="phone" value={editedCustomer.phone} onChange={handleEditChange} className="w-full p-2 border rounded-lg" /></div>
                                <div><label className="text-xs font-medium">Email</label><input type="email" name="email" value={editedCustomer.email} onChange={handleEditChange} className="w-full p-2 border rounded-lg" /></div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div><label className="text-xs font-medium">Mã Vải</label><input type="text" name="fabricCode" value={editedCustomer.fabricCode} onChange={handleEditChange} className="w-full p-2 border rounded-lg" /></div>
                                <div className="col-span-2 sm:col-span-3"><ImageUploadInput label="Đổi Ảnh Vải" value={editedCustomer.fabricImageURL} onChange={(base64) => setEditedCustomer({...editedCustomer, fabricImageURL: base64})} /></div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div><label className="text-xs font-medium">Ngày Nhận</label><input type="date" name="ngayNhan" value={editedCustomer.ngayNhan} onChange={handleEditChange} className="w-full p-2 border rounded-lg" /></div>
                                <div><label className="text-xs font-medium">Ngày Giao</label><input type="date" name="ngayGiao" value={editedCustomer.ngayGiao} onChange={handleEditChange} className="w-full p-2 border rounded-lg" /></div>
                                <div><label className="text-xs font-medium">Trạng Thái</label>
                                    <select name="status" value={editedCustomer.status} onChange={handleEditChange} className="w-full p-2 border rounded-lg"><option value="Chờ xử lý">Chờ xử lý</option><option value="Đang may">Đang may</option><option value="Hoàn thành">Hoàn thành</option><option value="Đã giao">Đã giao</option><option value="Đã hủy">Đã hủy</option></select>
                                </div>
                            </div>
                            <h4 className="text-sm font-bold text-[#133c3e] border-b pb-1 mt-4">Số Đo Áo/Vest</h4>
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2"><MeasurementInput label="Dài Áo" name="aoDai" value={editedCustomer.aoDai} onChange={handleEditChange} /><MeasurementInput label="Vai" name="vai" value={editedCustomer.vai} onChange={handleEditChange} /><MeasurementInput label="Tay" name="tay" value={editedCustomer.tay} onChange={handleEditChange} /><MeasurementInput label="Ngực" name="nguc" value={editedCustomer.nguc} onChange={handleEditChange} /><MeasurementInput label="Eo" name="eo" value={editedCustomer.eo} onChange={handleEditChange} /><MeasurementInput label="Mông" name="mong" value={editedCustomer.mong} onChange={handleEditChange} /><MeasurementInput label="Cổ" name="co" value={editedCustomer.co} onChange={handleEditChange} /><MeasurementInput label="Hạ eo" name="haEo" value={editedCustomer.haEo} onChange={handleEditChange} /></div>
                            <h4 className="text-sm font-bold text-[#133c3e] border-b pb-1 mt-4">Số Đo Quần/Váy</h4>
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2"><MeasurementInput label="Dài Quần" name="quanDai" value={editedCustomer.quanDai} onChange={handleEditChange} /><MeasurementInput label="Eo Quần" name="eoQuan" value={editedCustomer.eoQuan} onChange={handleEditChange} /><MeasurementInput label="Mông Quần" name="mongQuan" value={editedCustomer.mongQuan} onChange={handleEditChange} /><MeasurementInput label="Đáy" name="day" value={editedCustomer.day} onChange={handleEditChange} /><MeasurementInput label="Đùi" name="dui" value={editedCustomer.dui} onChange={handleEditChange} /><MeasurementInput label="Gối" name="goi" value={editedCustomer.goi} onChange={handleEditChange} /><MeasurementInput label="Ống" name="ong" value={editedCustomer.ong} onChange={handleEditChange} /></div>
                            <h4 className="text-sm font-bold text-red-700 border-b pb-1 mt-4">Thanh Toán</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><CurrencyInput label="Giá tiền" name="giaTien" value={editedCustomer.giaTien} onChange={handleEditChange} /><CurrencyInput label="Đã cọc" name="datTruoc" value={editedCustomer.datTruoc} onChange={handleEditChange} /><CurrencyInput label="Còn lại" name="conLai" value={editedCustomer.conLai} onChange={handleEditChange} readOnly={true} /></div>
                            <div><label className="text-xs font-medium">Ghi Chú</label><textarea name="notes" value={editedCustomer.notes} onChange={handleEditChange} rows="2" className="w-full p-2 border rounded-lg"></textarea></div>
                            <button type="submit" disabled={isSaving} className="w-full py-3 rounded-xl text-[#e5c07b] bg-[#133c3e] hover:bg-[#0f2d2f] font-black shadow-lg transition transform hover:scale-[1.02] border border-[#e5c07b]">
                                {isSaving ? 'Đang Lưu...' : '💾 XÁC NHẬN SỬA ĐƠN'}
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
const AdminDashboard = ({ userId, customers, showToast, isLoading, handleAddCustomer, handleInputChange, newCustomer, setNewCustomer, setIsAdding, isAdding, generateFitProfile, isGeneratingProfile, generatedProfile, shopLogo }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('Tất cả'); 
    
    // State cho công cụ Cắt Ảnh
    const [tempLogo, setTempLogo] = useState(null);

    const filteredCustomers = customers.filter(c => {
        const matchSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm) || (c.orderName||'').toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus = filterStatus === 'Tất cả' || c.status === filterStatus;
        return matchSearch && matchStatus;
    });

    const totalRevenue = filteredCustomers.reduce((sum, c) => sum + Number(c.giaTien || 0), 0);
    const totalUnpaid = filteredCustomers.reduce((sum