/**
 * 检验申请表单 — 送检医师提交检验申请
 */
import { useState, useEffect } from 'react';
import {
  Card, Form, Input, Select, Button, Space, message, Divider, Switch,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { labDictDb, labApplicationDb } from '../../../../providers/lab-db';

const PATIENT_TYPES = [
  { label: '门诊', value: '门诊' },
  { label: '住院', value: '住院' },
  { label: '急诊', value: '急诊' },
  { label: '健康体检', value: '健康体检' },
  { label: '外院', value: '外院' },
];

export default function ApplicationSubmitPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [requestItems, setRequestItems] = useState<{ code: string; name: string }[]>([]);
  const [entrustCollect, setEntrustCollect] = useState(false);

  useEffect(() => {
    labDictDb.requestItems().then(items => {
      setRequestItems(items.map(i => ({ code: i.req_item_code, name: i.req_item_name })));
    });
  }, []);

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      const applicationId = `APP-${Date.now()}`;
      const payload = {
        applicationId,
        sendingOrg: values.sendingOrg || 'NX-HOSP-001',
        status: 'submitted',
        patientName: values.patientName,
        sex: values.sex,
        age: values.age,
        patientId: values.patientId,
        patientPhone: values.patientPhone,
        patientType: values.patientType,
        diagnostic: values.diagnostic,
        bedNo: values.bedNo,
        wardName: values.wardName,
        sectionName: values.sectionName,
        requestMode: values.requestMode || '平诊',
        requester: values.requester || 'DR001',
        requestTime: new Date().toISOString(),
        sendFlag: 0,
        collectingOrgCode: entrustCollect ? values.collectingOrgCode : null,
        collectingOrgName: entrustCollect ? values.collectingOrgName : null,
        itemInfoList: (values.items || []).map((item: any) => ({
          itemCode: item.itemCode,
          itemName: requestItems.find(r => r.code === item.itemCode)?.name || '',
          sampleType: values.sampleType,
          requestMode: values.requestMode || '平诊',
          requester: values.requester || 'DR001',
          preparationNote: values.preparationNote,
        })),
      };
      const res = await labApplicationDb.submit(payload);
      if (res.code === 200) {
        message.success(`申请提交成功！申请单号: ${applicationId}`);
        form.resetFields();
      } else {
        message.error(res.message || '提交失败');
      }
    } catch (e: any) {
      message.error(e.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="检验申请单">
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ requestMode: '平诊', patientType: '门诊' }}>
          <Divider titlePlacement="start" plain>受检者信息</Divider>
          <Space wrap size="middle" style={{ display: 'flex' }}>
            <Form.Item name="patientName" label="姓名" rules={[{ required: true }]}>
              <Input placeholder="受检者姓名" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="sex" label="性别" rules={[{ required: true }]}>
              <Select style={{ width: 100 }} options={[{ label: '男', value: '男' }, { label: '女', value: '女' }, { label: '未知', value: '未知' }]} />
            </Form.Item>
            <Form.Item name="age" label="年龄" rules={[{ required: true }]}>
              <Input placeholder="如 35岁" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="patientId" label="身份证号/健康卡号" rules={[{ required: true }]}>
              <Input placeholder="唯一识别号" style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="patientPhone" label="联系电话">
              <Input placeholder="联系电话" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="patientType" label="病人类别">
              <Select style={{ width: 130 }} options={PATIENT_TYPES} />
            </Form.Item>
          </Space>

          <Divider titlePlacement="start" plain>就诊信息</Divider>
          <Space wrap size="middle" style={{ display: 'flex' }}>
            <Form.Item name="diagnostic" label="临床诊断">
              <Input placeholder="诊断名称（必要时）" style={{ width: 280 }} />
            </Form.Item>
            <Form.Item name="sectionName" label="开单科室">
              <Input placeholder="开单科室" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="wardName" label="病区">
              <Input placeholder="病区名称" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="bedNo" label="床号">
              <Input placeholder="床号" style={{ width: 100 }} />
            </Form.Item>
          </Space>

          <Divider titlePlacement="start" plain>检验信息</Divider>
          <Space wrap size="middle" style={{ display: 'flex' }}>
            <Form.Item name="sampleType" label="样本类型" rules={[{ required: true }]}>
              <Input placeholder="如 血清、全血" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="requestMode" label="申请模式">
              <Select style={{ width: 120 }} options={[{ label: '平诊', value: '平诊' }, { label: '急诊', value: '急诊' }]} />
            </Form.Item>
            <Form.Item name="requester" label="开单者">
              <Input placeholder="开单者代码" style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="preparationNote" label="受检者准备要求">
              <Input placeholder="如 空腹8小时" style={{ width: 200 }} />
            </Form.Item>
          </Space>

          <Divider titlePlacement="start" plain>检验项目</Divider>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline" style={{ marginBottom: 8 }}>
                    <Form.Item {...rest} name={[name, 'itemCode']} rules={[{ required: true, message: '请选择' }]}>
                      <Select
                        showSearch
                        placeholder="选择检验项目"
                        style={{ width: 320 }}
                        options={requestItems.map(i => ({ label: `${i.code} ${i.name}`, value: i.code }))}
                        filterOption={(input, option) =>
                          (option?.label as string).toLowerCase().includes(input.toLowerCase())
                        }
                      />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>添加检验项目</Button>
              </>
            )}
          </Form.List>

          <Divider titlePlacement="start" plain>
            采集机构信息
            <Switch
              checked={entrustCollect}
              onChange={setEntrustCollect}
              checkedChildren="异地采集"
              unCheckedChildren="同机构"
              style={{ marginLeft: 16 }}
            />
          </Divider>
          {entrustCollect && (
            <Space wrap size="middle" style={{ display: 'flex' }}>
              <Form.Item name="collectingOrgCode" label="采集机构代码" rules={[{ required: true, message: '异地采集时必填' }]}>
                <Input placeholder="采集机构代码" style={{ width: 180 }} />
              </Form.Item>
              <Form.Item name="collectingOrgName" label="采集机构名称" rules={[{ required: true, message: '异地采集时必填' }]}>
                <Input placeholder="采集机构名称" style={{ width: 200 }} />
              </Form.Item>
            </Space>
          )}

          <Divider titlePlacement="start" plain>送检机构</Divider>
          <Form.Item name="sendingOrg" label="送检机构代码">
            <Input placeholder="送检机构代码（默认 NX-HOSP-001）" style={{ width: 240 }} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>提交申请</Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
